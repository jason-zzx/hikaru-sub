#define WIN32_LEAN_AND_MEAN
#include <windows.h>

#include <algorithm>
#include <cwctype>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <map>
#include <set>
#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>

namespace {

struct SeedRow {
  const wchar_t* path;
  const wchar_t* seed;
};

constexpr SeedRow kSeeds[] = {
    {L"src/cuda/primitives.cu", L"0x1ebb9bcd"},
    {L"src/cuda/random.cu", L"0xdaa85471"},
    {L"src/ops/alibi_add_gpu.cu", L"0xaf20a1fc"},
    {L"src/ops/awq/dequantize_gpu.cu", L"0x052b082e"},
    {L"src/ops/awq/gemm_gpu.cu", L"0xf3fe739d"},
    {L"src/ops/awq/gemv_gpu.cu", L"0x0b56e0eb"},
    {L"src/ops/bias_add_gpu.cu", L"0x59078a51"},
    {L"src/ops/concat_split_slide_gpu.cu", L"0xe17007cd"},
    {L"src/ops/conv1d_gpu.cu", L"0x96c8336d"},
    {L"src/ops/dequantize_gpu.cu", L"0x1ed03aff"},
    {L"src/ops/flash_attention_gpu.cu", L"0x8eefbc58"},
    {L"src/ops/gather_gpu.cu", L"0x66d72e47"},
    {L"src/ops/gumbel_max_gpu.cu", L"0xe6259371"},
    {L"src/ops/layer_norm_gpu.cu", L"0x390b5e75"},
    {L"src/ops/mean_gpu.cu", L"0xc5f85f55"},
    {L"src/ops/median_filter_gpu.cu", L"0xda09de12"},
    {L"src/ops/multinomial_gpu.cu", L"0x75feda7b"},
    {L"src/ops/nccl_ops_gpu.cu", L"0xc2bd59f6"},
    {L"src/ops/quantize_gpu.cu", L"0xa1557031"},
    {L"src/ops/rms_norm_gpu.cu", L"0x221d2825"},
    {L"src/ops/rotary_gpu.cu", L"0x310e8eb5"},
    {L"src/ops/softmax_gpu.cu", L"0x5b569f0d"},
    {L"src/ops/tile_gpu.cu", L"0x32919547"},
    {L"src/ops/topk_gpu.cu", L"0xaff2f1a6"},
    {L"src/ops/topp_mask_gpu.cu", L"0xe0f8bbc8"},
};

struct PathmapRow {
  std::wstring label;
  std::wstring canonical_root;
  std::wstring native_root;
};

struct LauncherConfig {
  std::filesystem::path source_root;
  std::filesystem::path real_nvcc;
  std::vector<PathmapRow> pathmaps;
};

std::wstring lower(std::wstring value) {
  std::transform(value.begin(), value.end(), value.begin(), [](wchar_t value) {
    return static_cast<wchar_t>(std::towlower(value));
  });
  return value;
}

std::filesystem::path executable_path() {
  std::vector<wchar_t> buffer(32768);
  const DWORD length = GetModuleFileNameW(nullptr, buffer.data(), static_cast<DWORD>(buffer.size()));
  if (length == 0 || length >= buffer.size())
    throw std::runtime_error("launcher executable path is unavailable");
  return std::filesystem::canonical(std::filesystem::path(buffer.data(), buffer.data() + length));
}

std::wstring utf8_to_wide(const std::string& value) {
  if (value.empty())
    return {};
  const int length = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value.data(),
                                         static_cast<int>(value.size()), nullptr, 0);
  if (length <= 0)
    throw std::runtime_error("launcher config is not valid UTF-8");
  std::wstring result(static_cast<std::size_t>(length), L'\0');
  if (MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value.data(),
                          static_cast<int>(value.size()), result.data(), length) != length)
    throw std::runtime_error("launcher config UTF-8 conversion failed");
  return result;
}

std::filesystem::path canonical_config_path(const std::string& value, const char* name) {
  if (value.find('\\') != std::string::npos)
    throw std::runtime_error(std::string(name) + " must use canonical forward slashes");
  const std::filesystem::path supplied(utf8_to_wide(value));
  if (!supplied.is_absolute())
    throw std::runtime_error(std::string(name) + " must be absolute");
  const std::filesystem::path canonical = std::filesystem::canonical(supplied);
  if (lower(canonical.generic_wstring()) != lower(supplied.generic_wstring()))
    throw std::runtime_error(std::string(name) + " is not canonical");
  return canonical;
}

LauncherConfig load_config() {
  const std::filesystem::path launcher = executable_path();
  const std::filesystem::path config_path = launcher.parent_path() / L"hikaru-nvcc-launcher.cfg";
  std::ifstream stream(config_path, std::ios::binary);
  if (!stream)
    throw std::runtime_error("adjacent launcher config is missing");

  std::map<std::string, std::string> values;
  std::string line;
  while (std::getline(stream, line)) {
    if (!line.empty() && line.back() == '\r')
      line.pop_back();
    if (line.empty())
      continue;
    const std::size_t separator = line.find('=');
    if (separator == std::string::npos || separator == 0 || separator + 1 >= line.size())
      throw std::runtime_error("adjacent launcher config is malformed");
    if (!values.emplace(line.substr(0, separator), line.substr(separator + 1)).second)
      throw std::runtime_error("adjacent launcher config contains duplicate keys");
  }
  if (!stream.eof())
    throw std::runtime_error("adjacent launcher config could not be read");
  if (values.size() != 8 || values["schemaVersion"] != "2" ||
      values.find("ct2SourceRoot") == values.end())
    throw std::runtime_error("adjacent launcher config contract drifted");

  const std::filesystem::path real_nvcc =
      std::filesystem::canonical(launcher.parent_path() / L"nvcc-real.exe");
  const std::filesystem::path source_root =
      canonical_config_path(values["ct2SourceRoot"], "ct2SourceRoot");
  const std::wstring expected_labels[] = {L"build", L"native-asr", L"source"};
  std::vector<PathmapRow> pathmaps;
  for (std::size_t index = 0; index < std::size(expected_labels); ++index) {
    const std::string prefix = "pathmap" + std::to_string(index);
    const auto label = values.find(prefix + "Label");
    const auto root = values.find(prefix + "Root");
    if (label == values.end() || root == values.end() ||
        utf8_to_wide(label->second) != expected_labels[index])
      throw std::runtime_error("adjacent launcher pathmap contract drifted");
    const std::filesystem::path canonical =
        canonical_config_path(root->second, (prefix + "Root").c_str());
    pathmaps.push_back({expected_labels[index], canonical.generic_wstring(), canonical.wstring()});
  }
  if (lower(launcher.wstring()) == lower(real_nvcc.wstring()))
    throw std::runtime_error("NVCC launcher recursion is forbidden");
  return {source_root, real_nvcc, pathmaps};
}

std::wstring quote_windows_arg(const std::wstring& arg) {
  if (arg.empty())
    return L"\"\"";
  if (arg.find_first_of(L" \t\n\v\"") == std::wstring::npos)
    return arg;

  std::wstring quoted = L"\"";
  std::size_t backslashes = 0;
  for (const wchar_t ch : arg) {
    if (ch == L'\\') {
      ++backslashes;
    } else if (ch == L'\"') {
      quoted.append(backslashes * 2 + 1, L'\\');
      quoted.push_back(L'\"');
      backslashes = 0;
    } else {
      quoted.append(backslashes, L'\\');
      backslashes = 0;
      quoted.push_back(ch);
    }
  }
  quoted.append(backslashes * 2, L'\\');
  quoted.push_back(L'\"');
  return quoted;
}

void validate_seed_table() {
  std::set<std::wstring> paths;
  std::set<std::wstring> seeds;
  std::wstring previous;
  for (const auto& row : kSeeds) {
    const std::wstring path = row.path;
    const std::wstring seed = lower(row.seed);
    if (path.empty() || path.find(L'\\') != std::wstring::npos || path.size() < 3 ||
        path.substr(path.size() - 3) != L".cu")
      throw std::runtime_error("invalid compiled CUDA source mapping");
    if (!previous.empty() && previous >= path)
      throw std::runtime_error("CUDA source mappings are not uniquely sorted");
    if (!paths.insert(lower(path)).second || !seeds.insert(seed).second || seed == L"0x00000000")
      throw std::runtime_error("duplicate or zero CUDA seed mapping");
    previous = path;
  }
}

bool has_cu_extension(const std::wstring& arg) {
  return lower(std::filesystem::path(arg).extension().wstring()) == L".cu";
}

std::wstring canonical_relative_source(const std::filesystem::path& source_root,
                                       const std::wstring& source_arg) {
  const std::filesystem::path source =
      std::filesystem::weakly_canonical(std::filesystem::path(source_arg));
  const std::filesystem::path relative = source.lexically_relative(source_root);
  if (relative.empty() || relative.is_absolute())
    throw std::runtime_error("CUDA source is outside the pinned CTranslate2 root");
  for (const auto& component : relative) {
    if (component == L"..")
      throw std::runtime_error("CUDA source is outside the pinned CTranslate2 root");
  }
  return relative.generic_wstring();
}

const SeedRow& lookup_seed(const std::wstring& relative) {
  const std::wstring target = lower(relative);
  for (const auto& row : kSeeds) {
    if (lower(row.path) == target)
      return row;
  }
  throw std::runtime_error("unknown CTranslate2 CUDA source; seed mapping must be reviewed");
}

std::vector<std::wstring> configured_pathmap_args(const LauncherConfig& config) {
  std::vector<std::wstring> args;
  for (const auto& row : config.pathmaps)
    args.push_back(L"-Xcompiler=/pathmap:" + row.canonical_root + L"=" + row.label);
  return args;
}

std::vector<std::wstring> prepare_nvcc_args(const std::vector<std::wstring>& input,
                                            const LauncherConfig& config,
                                            bool log_seed) {
  constexpr std::wstring_view pathmap_prefix = L"-Xcompiler=/pathmap:";
  const std::wstring normalized_pathmap_prefix = lower(std::wstring(pathmap_prefix));
  std::vector<std::wstring> args = input;
  std::vector<std::wstring> cuda_sources;
  std::size_t pathmap_index = 0;
  for (auto& arg : args) {
    const std::wstring normalized = lower(arg);
    if (normalized.rfind(L"--frandom-seed", 0) == 0 ||
        normalized.rfind(L"-frandom-seed", 0) == 0)
      throw std::runtime_error("global or duplicate --frandom-seed is forbidden");
    if (normalized.rfind(normalized_pathmap_prefix, 0) == 0) {
      if (arg.rfind(pathmap_prefix, 0) != 0 || pathmap_index >= config.pathmaps.size())
        throw std::runtime_error("unexpected or malformed CUDA host pathmap");
      const PathmapRow& expected = config.pathmaps[pathmap_index++];
      const std::wstring suffix = L"=" + expected.label;
      if (arg.size() <= pathmap_prefix.size() + suffix.size() ||
          arg.substr(arg.size() - suffix.size()) != suffix)
        throw std::runtime_error("unexpected CUDA host pathmap label or order");
      const std::wstring source = arg.substr(
          pathmap_prefix.size(), arg.size() - pathmap_prefix.size() - suffix.size());
      if (source.find(L'\\') != std::wstring::npos ||
          lower(source) != lower(expected.canonical_root))
        throw std::runtime_error("CUDA host pathmap source does not match adjacent config");
      arg = std::wstring(pathmap_prefix) + expected.native_root + suffix;
    }
    if (has_cu_extension(arg))
      cuda_sources.push_back(arg);
  }

  if (cuda_sources.size() > 1)
    throw std::runtime_error("multiple CUDA sources in one nvcc invocation are forbidden");
  if (pathmap_index != 0 && pathmap_index != config.pathmaps.size())
    throw std::runtime_error("CUDA host pathmaps are incomplete");
  if (cuda_sources.size() == 1) {
    if (pathmap_index != config.pathmaps.size())
      throw std::runtime_error("CUDA source invocation is missing locked host pathmaps");
    const std::wstring relative = canonical_relative_source(config.source_root, cuda_sources.front());
    const SeedRow& row = lookup_seed(relative);
    args.emplace_back(std::wstring(L"--frandom-seed=") + row.seed);
    if (log_seed)
      std::wcerr << L"hikaru-nvcc-seed " << row.path << L" " << row.seed << L"\n";
  } else if (pathmap_index != 0) {
    throw std::runtime_error("CUDA host pathmaps require one locked CUDA source");
  }
  return args;
}

void expect_failure(const std::vector<std::wstring>& args, const LauncherConfig& config) {
  try {
    static_cast<void>(prepare_nvcc_args(args, config, false));
  } catch (const std::exception&) {
    return;
  }
  throw std::runtime_error("launcher self-test expected a fail-closed argument set");
}

void run_self_test(const LauncherConfig& config) {
  const std::filesystem::path known_source = config.source_root / kSeeds[0].path;
  std::vector<std::wstring> input = {known_source.wstring()};
  const std::vector<std::wstring> pathmaps = configured_pathmap_args(config);
  input.insert(input.end(), pathmaps.begin(), pathmaps.end());
  const std::vector<std::wstring> planned = prepare_nvcc_args(input, config, false);
  if (planned.size() != input.size() + 1 ||
      planned.back() != std::wstring(L"--frandom-seed=") + kSeeds[0].seed)
    throw std::runtime_error("launcher self-test did not inject exactly one known seed");
  for (std::size_t index = 0; index < config.pathmaps.size(); ++index) {
    const std::wstring expected = L"-Xcompiler=/pathmap:" +
                                  config.pathmaps[index].native_root + L"=" +
                                  config.pathmaps[index].label;
    if (planned[index + 1] != expected)
      throw std::runtime_error("launcher self-test did not native-rewrite a locked pathmap");
  }

  expect_failure({known_source.wstring(), L"--frandom-seed=0x1"}, config);
  expect_failure({known_source.wstring(),
                  (config.source_root / kSeeds[1].path).wstring()},
                 config);
  expect_failure({(config.source_root / L"src/unknown.cu").wstring()}, config);
  expect_failure({known_source.wstring()}, config);
  std::vector<std::wstring> malformed = input;
  malformed[1] = L"-Xcompiler=/pathmap:relative=build";
  expect_failure(malformed, config);
  std::vector<std::wstring> duplicate = input;
  duplicate[2] = duplicate[1];
  expect_failure(duplicate, config);
  std::vector<std::wstring> unexpected = input;
  unexpected[1] = L"-Xcompiler=/pathmap:" + config.pathmaps[0].canonical_root + L"=other";
  expect_failure(unexpected, config);
}

int launch_real_nvcc(const std::filesystem::path& real_nvcc,
                     const std::vector<std::wstring>& args) {
  std::wstring command = quote_windows_arg(real_nvcc.wstring());
  for (const auto& arg : args) {
    command.push_back(L' ');
    command.append(quote_windows_arg(arg));
  }
  std::vector<wchar_t> mutable_command(command.begin(), command.end());
  mutable_command.push_back(L'\0');

  STARTUPINFOW startup{};
  startup.cb = sizeof(startup);
  PROCESS_INFORMATION process{};
  if (!CreateProcessW(real_nvcc.c_str(), mutable_command.data(), nullptr, nullptr, TRUE, 0,
                      nullptr, nullptr, &startup, &process))
    throw std::runtime_error("failed to start the pinned real nvcc");

  CloseHandle(process.hThread);
  const DWORD wait = WaitForSingleObject(process.hProcess, INFINITE);
  if (wait != WAIT_OBJECT_0) {
    CloseHandle(process.hProcess);
    throw std::runtime_error("failed while waiting for the pinned real nvcc");
  }
  DWORD exit_code = 1;
  if (!GetExitCodeProcess(process.hProcess, &exit_code)) {
    CloseHandle(process.hProcess);
    throw std::runtime_error("failed to read the pinned real nvcc exit code");
  }
  CloseHandle(process.hProcess);
  return static_cast<int>(exit_code);
}

}  // namespace

int wmain(int argc, wchar_t** argv) {
  try {
    validate_seed_table();
    if (argc == 3 && std::wstring_view(argv[1]) == L"--hikaru-seed-for") {
      const SeedRow& row = lookup_seed(argv[2]);
      std::wcout << row.seed << L"\n";
      return 0;
    }

    const LauncherConfig config = load_config();
    if (argc == 2 && std::wstring_view(argv[1]) == L"--hikaru-self-test") {
      run_self_test(config);
      std::wcout << L"ok sources=" << std::size(kSeeds) << L"\n";
      return 0;
    }

    const bool dry_run = argc >= 2 && std::wstring_view(argv[1]) == L"--hikaru-dry-run";
    std::vector<std::wstring> input;
    input.reserve(static_cast<std::size_t>(argc - (dry_run ? 2 : 1)));
    for (int index = dry_run ? 2 : 1; index < argc; ++index)
      input.emplace_back(argv[index]);
    const std::vector<std::wstring> planned = prepare_nvcc_args(input, config, !dry_run);
    if (dry_run) {
      for (const auto& arg : planned)
        std::wcout << arg << L"\n";
      return 0;
    }
    return launch_real_nvcc(config.real_nvcc, planned);
  } catch (const std::exception& error) {
    std::cerr << "hikaru-nvcc-launcher: " << error.what() << "\n";
    return 86;
  }
}

//! Bounded model-free full-CLI probe. Never confused with model graph evidence.
use super::*;
use std::io::Read;
use std::time::{Duration, Instant};

const FAILED: &str = "[crispasr_cuda_probe_failed] CrispASR CUDA 启动前探测失败";
const LIMIT: usize = 16 * 1024;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Capability {
    schema_version: u32,
    backend: String,
    device: String,
    operation: String,
    nodes: u32,
    other_device_nodes: u32,
    result_verified: bool,
    model_execution_proof: bool,
}

fn validate(bytes: &[u8]) -> Result<(), String> {
    if bytes.len() > LIMIT || bytes.contains(&0) {
        return Err(FAILED.into());
    }
    let text = std::str::from_utf8(bytes).map_err(|_| FAILED)?;
    if text.lines().count() != 1 {
        return Err(FAILED.into());
    }
    // Derived struct rejects duplicate fields; from_slice consumes the whole
    // span and rejects trailing documents, invalid UTF-8 and escaped surrogates.
    let value: Capability = serde_json::from_slice(bytes).map_err(|_| FAILED)?;
    if value.schema_version != 1
        || value.backend != "crispasr"
        || value.device != "cuda"
        || value.operation != "ggml-add-f32"
        || value.nodes != 1
        || value.other_device_nodes != 0
        || !value.result_verified
        || value.model_execution_proof
    {
        return Err(FAILED.into());
    }
    Ok(())
}

#[cfg(windows)]
fn run(root: &Path, cli: &Path, timeout: Duration) -> Result<(), String> {
    use crate::asr_worker::worker_job::WorkerJob;
    use std::os::windows::process::CommandExt;
    let job = WorkerJob::new().map_err(|_| FAILED)?;
    let system = std::env::var_os("SystemRoot").ok_or(FAILED)?;
    let mut child = hidden_command(cli)
        .arg("--hikaru-probe-cuda")
        .env_clear()
        .env("SystemRoot", &system)
        .env("WINDIR", &system)
        .env("PATH", cuda_restricted_path(root).map_err(|_| FAILED)?)
        .current_dir(root)
        .creation_flags(crate::process::CREATE_NO_WINDOW | 0x4)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|_| FAILED)?;
    if job.attach_and_resume(&mut child).is_err() {
        let _ = child.kill();
        let _ = child.wait();
        let _ = job.reap(Duration::from_secs(2));
        return Err(FAILED.into());
    }
    fn drain(
        stream: impl Read + Send + 'static,
    ) -> std::thread::JoinHandle<std::io::Result<Vec<u8>>> {
        std::thread::spawn(move || {
            let mut bytes = Vec::new();
            stream.take((LIMIT + 1) as u64).read_to_end(&mut bytes)?;
            Ok(bytes)
        })
    }
    let stdout = drain(child.stdout.take().ok_or(FAILED)?);
    let stderr = drain(child.stderr.take().ok_or(FAILED)?);
    let start = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Err(_) => break None,
            Ok(None) if start.elapsed() >= timeout => break None,
            Ok(None) => std::thread::sleep(Duration::from_millis(5)),
        }
    };
    // Kill/reap descendants even when the parent exited zero. Do not join a
    // reader while a child can still own its pipe; Drop also closes the Job.
    job.reap(Duration::from_secs(2)).map_err(|_| FAILED)?;
    child.wait().map_err(|_| FAILED)?;
    let stdout = stdout.join().map_err(|_| FAILED)?.map_err(|_| FAILED)?;
    let stderr = stderr.join().map_err(|_| FAILED)?.map_err(|_| FAILED)?;
    if !status.is_some_and(|status| status.success()) || stderr.len() > LIMIT {
        return Err(FAILED.into());
    }
    validate(&stdout)
}

pub(super) fn probe(root: &Path) -> Result<(), String> {
    #[cfg(windows)]
    return run(root, &root.join("crispasr.exe"), Duration::from_secs(15));
    #[cfg(not(windows))]
    {
        let _ = root;
        Err(FAILED.into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const GOOD: &str = "{\"schemaVersion\":1,\"backend\":\"crispasr\",\"device\":\"cuda\",\"operation\":\"ggml-add-f32\",\"nodes\":1,\"otherDeviceNodes\":0,\"resultVerified\":true,\"modelExecutionProof\":false}";

    #[test]
    fn capability_is_strict_and_not_model_execution_proof() {
        assert!(validate(format!("{GOOD}\n").as_bytes()).is_ok());
        let mut cases = vec![vec![], vec![b'x'; LIMIT + 1]];
        for tail in ["\0", "\0junk", "{}", "\n{}", "\n\n"] {
            cases.push(format!("{GOOD}{tail}").into_bytes());
        }
        cases.push([GOOD.as_bytes(), &[0xff]].concat());
        for (from, to) in [
            ("\"cuda\"", "\"cpu\""),
            ("\"crispasr\"", "\"ctranslate2\""),
            ("\"nodes\":1", "\"nodes\":0"),
            ("\"nodes\":1", "\"nodes\":1.0"),
            ("\"otherDeviceNodes\":0", "\"otherDeviceNodes\":1"),
            ("\"resultVerified\":true", "\"resultVerified\":false"),
            (
                "\"modelExecutionProof\":false",
                "\"modelExecutionProof\":true",
            ),
            (
                "\"schemaVersion\":1",
                "\"schemaVersion\":1,\"schemaVersion\":1",
            ),
            (
                "\"operation\":\"ggml-add-f32\"",
                "\"operation\":\"\\ud800\"",
            ),
        ] {
            cases.push(GOOD.replace(from, to).into_bytes());
        }
        for bytes in cases {
            assert!(validate(&bytes).is_err(), "accepted malformed probe");
        }
    }

    #[cfg(windows)]
    #[test]
    fn real_probe_from_full_cli_inputs() {
        let Some(path) = std::env::var_os("HIKARU_ASR_CRISPASR_PROBE_INPUTS") else {
            assert_ne!(
                std::env::var("HIKARU_ASR_CRISPASR_PROBE_REQUIRED").as_deref(),
                Ok("1")
            );
            return;
        };
        let input: serde_json::Value = serde_json::from_slice(&fs::read(path).unwrap()).unwrap();
        assert_eq!(input["schema"], "qwen-full-cli-host-v1");
        let worker = PathBuf::from(input["worker"]["path"].as_str().unwrap());
        let root = worker.parent().unwrap();
        for row in input["runtime"]
            .as_array()
            .unwrap()
            .iter()
            .chain(std::iter::once(&input["worker"]))
        {
            let file = PathBuf::from(row["path"].as_str().unwrap());
            assert_eq!(file.parent(), Some(root));
            assert!(file.is_file());
        }
        assert_eq!(probe(root).is_ok(), input["device"] == "cuda");
    }

    #[cfg(windows)]
    #[test]
    fn fixture_probe_exit_timeout_output_and_descendant_cleanup() {
        let Some(worker) = std::env::var_os("HIKARU_ASR_QWEN_CLI_FIXTURE_WORKER") else {
            return;
        };
        let source = PathBuf::from(worker).parent().unwrap().join("crispasr.exe");
        let dir = tempfile::tempdir().unwrap();
        for scenario in [
            "success",
            "nonzero",
            "hang",
            "descendant",
            "bad",
            "duplicate",
            "nul",
            "utf8",
            "trailing",
            "device",
            "oversize",
            "stderr",
        ] {
            let cli = dir.path().join(format!("probe-{scenario}.exe"));
            fs::copy(&source, &cli).unwrap();
            let start = Instant::now();
            let result = run(dir.path(), &cli, Duration::from_millis(500));
            assert_eq!(result.is_ok(), scenario == "success", "{scenario}");
            assert!(start.elapsed() < Duration::from_secs(4));
            // Windows executable deletion also proves the root has exited; run
            // independently confirms zero active Job descendants before return.
            fs::remove_file(cli).unwrap();
        }
    }
}

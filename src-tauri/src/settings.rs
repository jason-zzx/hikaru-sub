use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RuntimeDependencySourceMode {
    Auto,
    Official,
    China,
    Custom,
}

impl Default for RuntimeDependencySourceMode {
    fn default() -> Self {
        Self::Auto
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CustomRuntimeSourceProfile {
    pub ffmpeg_url: Option<String>,
    pub python311_url: Option<String>,
    pub pip_index_url: Option<String>,
    pub pip_extra_index_urls: Vec<String>,
    pub pytorch_cpu_index_url: Option<String>,
    pub pytorch_cuda_index_url: Option<String>,
    pub pytorch_cpu_find_links_url: Option<String>,
    pub pytorch_cuda_find_links_url: Option<String>,
    pub huggingface_endpoint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppSettings {
    pub ffmpeg_path: Option<String>,
    pub python_path: Option<String>,
    pub asr_service_path: Option<String>,
    pub asr_engine: String,
    pub asr_model: String,
    pub asr_device: String,
    pub translation_base_url: String,
    pub translation_model: String,
    pub translation_api_key: Option<String>,
    pub default_source_lang: String,
    pub default_target_lang: String,
    pub translation_batch_size: u32,
    pub translation_context_window: u32,
    pub translation_custom_prompt: Option<String>,
    pub translation_glossary: Option<String>,
    pub subtitle_merge_mode: String,
    pub runtime_source_mode: RuntimeDependencySourceMode,
    pub runtime_recommended_profile: Option<String>,
    pub runtime_recommendation_checked_at: Option<String>,
    pub runtime_custom_source: CustomRuntimeSourceProfile,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            ffmpeg_path: None,
            python_path: None,
            asr_service_path: None,
            asr_engine: "faster-whisper".into(),
            asr_model: "large-v3".into(),
            asr_device: "auto".into(),
            translation_base_url: "https://api.openai.com/v1".into(),
            translation_model: "gpt-4o-mini".into(),
            translation_api_key: None,
            default_source_lang: "ja".into(),
            default_target_lang: "zh-CN".into(),
            translation_batch_size: 25,
            translation_context_window: 2,
            translation_custom_prompt: None,
            translation_glossary: None,
            subtitle_merge_mode: "inline".into(),
            runtime_source_mode: RuntimeDependencySourceMode::Auto,
            runtime_recommended_profile: None,
            runtime_recommendation_checked_at: None,
            runtime_custom_source: CustomRuntimeSourceProfile::default(),
        }
    }
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("settings.json"))
}

pub fn load_settings(app: &AppHandle) -> Result<AppSettings, String> {
    let path = settings_path(app)?;
    if !path.exists() {
        return Ok(AppSettings::default());
    }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let mut settings: AppSettings = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    let app_data_dir = app.path().app_data_dir().ok();
    sanitize_settings_for_runtime(
        &mut settings,
        app_data_dir.as_deref(),
        !cfg!(debug_assertions),
    );
    Ok(settings)
}

pub fn save_settings(app: &AppHandle, settings: &AppSettings) -> Result<(), String> {
    let path = settings_path(app)?;
    let content = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    fs::write(path, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_settings(app: AppHandle) -> Result<AppSettings, String> {
    load_settings(&app)
}

#[tauri::command]
pub fn set_settings(app: AppHandle, settings: AppSettings) -> Result<(), String> {
    save_settings(&app, &settings)
}

fn sanitize_settings_for_runtime(
    settings: &mut AppSettings,
    app_data_dir: Option<&Path>,
    packaged_runtime: bool,
) {
    clear_empty(&mut settings.ffmpeg_path);
    clear_empty(&mut settings.python_path);
    clear_empty(&mut settings.asr_service_path);

    clear_missing_file_path(&mut settings.ffmpeg_path);
    clear_missing_file_path(&mut settings.python_path);
    clear_missing_asr_service_path(&mut settings.asr_service_path);

    if !packaged_runtime {
        return;
    }

    let source_service_dir = settings
        .asr_service_path
        .as_deref()
        .map(PathBuf::from)
        .filter(|path| is_source_checkout_asr_service(path, app_data_dir));

    if let Some(service_dir) = source_service_dir.as_deref() {
        settings.asr_service_path = None;
        if settings
            .python_path
            .as_deref()
            .is_some_and(|path| path_is_under(Path::new(path), service_dir))
        {
            settings.python_path = None;
        }
    }

    if settings
        .python_path
        .as_deref()
        .is_some_and(|path| is_source_checkout_python(Path::new(path), app_data_dir))
    {
        settings.python_path = None;
    }
}

fn clear_empty(value: &mut Option<String>) {
    if value.as_deref().is_some_and(|path| path.trim().is_empty()) {
        *value = None;
    }
}

fn looks_like_filesystem_path(value: &str) -> bool {
    value.contains('/')
        || value.contains('\\')
        || value.contains(':')
        || Path::new(value).is_absolute()
}

fn clear_missing_file_path(value: &mut Option<String>) {
    let Some(path) = value.as_deref() else {
        return;
    };
    if looks_like_filesystem_path(path) && !Path::new(path).is_file() {
        *value = None;
    }
}

fn clear_missing_asr_service_path(value: &mut Option<String>) {
    let Some(path) = value.as_deref() else {
        return;
    };
    let dir = Path::new(path);
    if !dir.is_dir() || !dir.join("main.py").is_file() {
        *value = None;
    }
}

fn path_is_under(path: &Path, parent: &Path) -> bool {
    let path = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    let parent = parent
        .canonicalize()
        .unwrap_or_else(|_| parent.to_path_buf());
    path.starts_with(parent)
}

fn is_source_checkout_asr_service(service_dir: &Path, app_data_dir: Option<&Path>) -> bool {
    if app_data_dir.is_some_and(|dir| path_is_under(service_dir, dir)) {
        return false;
    }
    if !service_dir.join("main.py").is_file() {
        return false;
    }
    service_dir.ancestors().any(|ancestor| {
        ancestor.join("src-tauri").join("tauri.conf.json").is_file()
            && (ancestor.join("package.json").is_file()
                || ancestor.join("pnpm-workspace.yaml").is_file())
            && ancestor.join("asr-service").join("main.py").is_file()
    })
}

fn is_source_checkout_python(python_path: &Path, app_data_dir: Option<&Path>) -> bool {
    if app_data_dir.is_some_and(|dir| path_is_under(python_path, dir)) {
        return false;
    }
    python_path
        .ancestors()
        .find(|ancestor| ancestor.join("main.py").is_file())
        .is_some_and(|service_dir| is_source_checkout_asr_service(service_dir, app_data_dir))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    fn temp_dir(name: &str) -> PathBuf {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("hikaru_sub_settings_{name}_{unique}"))
    }

    fn create_source_checkout_asr_service(root: &Path) -> PathBuf {
        let service = root.join("asr-service");
        std::fs::create_dir_all(service.join(".venv").join("Scripts")).unwrap();
        std::fs::create_dir_all(root.join("src-tauri")).unwrap();
        std::fs::write(root.join("package.json"), "{}").unwrap();
        std::fs::write(root.join("pnpm-workspace.yaml"), "packages: []").unwrap();
        std::fs::write(root.join("src-tauri").join("tauri.conf.json"), "{}").unwrap();
        std::fs::write(service.join("main.py"), "").unwrap();
        std::fs::write(service.join(".venv").join("Scripts").join("python.exe"), "").unwrap();
        service
    }

    #[test]
    fn default_runtime_dependency_source_settings_are_auto() {
        let settings = AppSettings::default();

        assert_eq!(
            settings.runtime_source_mode,
            RuntimeDependencySourceMode::Auto
        );
        assert_eq!(settings.runtime_recommended_profile, None);
        assert_eq!(settings.runtime_recommendation_checked_at, None);
        assert_eq!(
            settings.runtime_custom_source.pip_extra_index_urls,
            Vec::<String>::new()
        );
    }

    #[test]
    fn packaged_runtime_clears_source_checkout_asr_paths() {
        let root = temp_dir("source_checkout");
        let service = create_source_checkout_asr_service(&root);
        let mut settings = AppSettings {
            asr_service_path: Some(service.to_string_lossy().into_owned()),
            python_path: Some(
                service
                    .join(".venv")
                    .join("Scripts")
                    .join("python.exe")
                    .to_string_lossy()
                    .into_owned(),
            ),
            ..AppSettings::default()
        };

        sanitize_settings_for_runtime(&mut settings, None, true);

        assert_eq!(settings.asr_service_path, None);
        assert_eq!(settings.python_path, None);

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn packaged_runtime_keeps_managed_asr_paths_under_install_deps() {
        let install_dir = temp_dir("install_dir").join("hikaru-sub");
        let deps = install_dir.join("deps");
        let service = deps.join("asr-service");
        std::fs::create_dir_all(service.join(".venv").join("Scripts")).unwrap();
        std::fs::write(service.join("main.py"), "").unwrap();
        std::fs::write(service.join(".venv").join("Scripts").join("python.exe"), "").unwrap();
        let mut settings = AppSettings {
            asr_service_path: Some(service.to_string_lossy().into_owned()),
            python_path: Some(
                service
                    .join(".venv")
                    .join("Scripts")
                    .join("python.exe")
                    .to_string_lossy()
                    .into_owned(),
            ),
            ..AppSettings::default()
        };

        sanitize_settings_for_runtime(&mut settings, None, true);

        assert_eq!(
            settings.asr_service_path.as_deref(),
            Some(service.to_string_lossy().as_ref())
        );
        assert!(settings
            .python_path
            .as_deref()
            .is_some_and(|path| path.ends_with("python.exe")));

        let _ = std::fs::remove_dir_all(install_dir);
    }

    #[test]
    fn runtime_clears_missing_explicit_executable_and_service_paths() {
        let mut settings = AppSettings {
            ffmpeg_path: Some(r"C:\missing\ffmpeg.exe".into()),
            python_path: Some(r"C:\missing\python.exe".into()),
            asr_service_path: Some(r"C:\missing\asr-service".into()),
            ..AppSettings::default()
        };

        sanitize_settings_for_runtime(&mut settings, None, false);

        assert_eq!(settings.ffmpeg_path, None);
        assert_eq!(settings.python_path, None);
        assert_eq!(settings.asr_service_path, None);
    }
}

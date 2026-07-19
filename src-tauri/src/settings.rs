use serde::{Deserialize, Deserializer, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

const DEFAULT_PROVIDER_ID: &str = "default-provider";
const DEFAULT_OPENAI_BASE_URL: &str = "https://api.openai.com/v1";
const DEFAULT_OPENAI_MODEL: &str = "gpt-4o-mini";

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RuntimeDependencySourceMode {
    Official,
    China,
}

impl Default for RuntimeDependencySourceMode {
    fn default() -> Self {
        Self::Official
    }
}

impl<'de> Deserialize<'de> for RuntimeDependencySourceMode {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let value = String::deserialize(deserializer)?;
        match value.as_str() {
            "china" => Ok(Self::China),
            // official + legacy auto/custom + anything unknown → official
            _ => Ok(Self::Official),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum TranslationApiType {
    #[default]
    OpenaiCompatible,
    Gemini,
    Anthropic,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
pub struct TranslationProviderSettings {
    pub id: String,
    pub name: String,
    pub api_type: TranslationApiType,
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub max_concurrency: i64,
    pub requests_per_minute: i64,
}

impl Default for TranslationProviderSettings {
    fn default() -> Self {
        Self {
            id: DEFAULT_PROVIDER_ID.into(),
            name: "OpenAI".into(),
            api_type: TranslationApiType::OpenaiCompatible,
            base_url: DEFAULT_OPENAI_BASE_URL.into(),
            api_key: String::new(),
            model: DEFAULT_OPENAI_MODEL.into(),
            max_concurrency: 1,
            requests_per_minute: 10,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EditorHotkeyOverride {
    pub id: String,
    pub key: String,
    pub ctrl: bool,
    pub alt: bool,
    pub shift: bool,
}

fn deserialize_editor_hotkeys<'de, D>(
    deserializer: D,
) -> Result<Vec<EditorHotkeyOverride>, D::Error>
where
    D: Deserializer<'de>,
{
    let serde_json::Value::Array(items) = serde_json::Value::deserialize(deserializer)? else {
        return Ok(Vec::new());
    };
    Ok(items
        .into_iter()
        .filter_map(|item| serde_json::from_value(item).ok())
        .collect())
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
    pub translation_providers: Vec<TranslationProviderSettings>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_translation_provider_id: Option<String>,
    pub default_source_lang: String,
    pub default_target_lang: String,
    pub translation_batch_size: u32,
    pub translation_context_window: u32,
    pub translation_custom_prompt: Option<String>,
    pub translation_glossary: Option<String>,
    pub subtitle_merge_mode: String,
    pub runtime_source_mode: RuntimeDependencySourceMode,
    #[serde(default, deserialize_with = "deserialize_editor_hotkeys")]
    pub editor_hotkeys: Vec<EditorHotkeyOverride>,
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
            translation_providers: vec![TranslationProviderSettings::default()],
            default_translation_provider_id: Some(DEFAULT_PROVIDER_ID.into()),
            default_source_lang: "ja".into(),
            default_target_lang: "zh-CN".into(),
            translation_batch_size: 25,
            translation_context_window: 2,
            translation_custom_prompt: None,
            translation_glossary: None,
            subtitle_merge_mode: "inline".into(),
            runtime_source_mode: RuntimeDependencySourceMode::Official,
            editor_hotkeys: Vec::new(),
        }
    }
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = crate::app_paths::app_config_dir(app)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("settings.json"))
}

pub fn load_settings(app: &AppHandle) -> Result<AppSettings, String> {
    let path = settings_path(app)?;
    if !path.exists() {
        return Ok(AppSettings::default());
    }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let mut settings = parse_settings_json(&content)?;
    let app_data_dir = crate::app_paths::app_data_dir(app).ok();
    sanitize_settings_for_runtime(
        &mut settings,
        app_data_dir.as_deref(),
        !cfg!(debug_assertions),
    );
    Ok(settings)
}

pub fn save_settings(app: &AppHandle, settings: &AppSettings) -> Result<(), String> {
    let path = settings_path(app)?;
    let mut normalized = settings.clone();
    normalize_translation_providers(&mut normalized);
    let content = serde_json::to_string_pretty(&normalized).map_err(|e| e.to_string())?;
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

fn parse_settings_json(content: &str) -> Result<AppSettings, String> {
    let mut value: serde_json::Value = serde_json::from_str(content).map_err(|e| e.to_string())?;
    migrate_legacy_translation_settings(&mut value);
    let mut settings: AppSettings = serde_json::from_value(value).map_err(|e| e.to_string())?;
    normalize_translation_providers(&mut settings);
    Ok(settings)
}

fn migrate_legacy_translation_settings(value: &mut serde_json::Value) {
    let Some(object) = value.as_object_mut() else {
        return;
    };
    if object.contains_key("translationProviders") {
        return;
    }

    let has_legacy_connection = object.contains_key("translationBaseUrl")
        || object.contains_key("translationModel")
        || object.contains_key("translationApiKey");
    if !has_legacy_connection {
        return;
    }

    let base_url = object
        .get("translationBaseUrl")
        .and_then(|value| value.as_str())
        .unwrap_or(DEFAULT_OPENAI_BASE_URL)
        .to_owned();
    let model = object
        .get("translationModel")
        .and_then(|value| value.as_str())
        .unwrap_or(DEFAULT_OPENAI_MODEL)
        .to_owned();
    let api_key = object
        .get("translationApiKey")
        .and_then(|value| value.as_str())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_default()
        .to_owned();
    let name = if base_url == DEFAULT_OPENAI_BASE_URL
        && model == DEFAULT_OPENAI_MODEL
        && api_key.is_empty()
    {
        "OpenAI"
    } else {
        "默认供应商"
    };

    let provider = serde_json::json!({
        "id": DEFAULT_PROVIDER_ID,
        "name": name,
        "apiType": "openai-compatible",
        "baseUrl": base_url,
        "apiKey": api_key,
        "model": model,
        "maxConcurrency": 1,
        "requestsPerMinute": 10,
    });
    object.insert(
        "translationProviders".into(),
        serde_json::Value::Array(vec![provider]),
    );
    object.insert(
        "defaultTranslationProviderId".into(),
        serde_json::Value::String(DEFAULT_PROVIDER_ID.into()),
    );
}

fn normalize_translation_providers(settings: &mut AppSettings) {
    for provider in &mut settings.translation_providers {
        provider.max_concurrency = provider.max_concurrency.clamp(1, 50);
        provider.requests_per_minute = provider.requests_per_minute.clamp(1, 100);
        if provider.api_key.trim().is_empty() {
            provider.api_key.clear();
        }
    }

    if settings.translation_providers.is_empty() {
        settings.default_translation_provider_id = None;
        return;
    }

    let default_exists = settings
        .default_translation_provider_id
        .as_deref()
        .is_some_and(|default_id| {
            settings
                .translation_providers
                .iter()
                .any(|provider| provider.id == default_id)
        });
    if !default_exists {
        settings.default_translation_provider_id =
            Some(settings.translation_providers[0].id.clone());
    }
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
    crate::dependencies::is_source_checkout_asr_service_dir(service_dir)
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
    fn default_runtime_dependency_source_settings_are_official() {
        let settings = AppSettings::default();
        assert_eq!(
            settings.runtime_source_mode,
            RuntimeDependencySourceMode::Official
        );
    }

    #[test]
    fn editor_hotkeys_default_empty_and_legacy_settings_deserialize() {
        let settings = parse_settings_json(r#"{"asrEngine":"faster-whisper"}"#).unwrap();
        assert!(settings.editor_hotkeys.is_empty());

        let settings = parse_settings_json(
            r#"{"editorHotkeys":[{"id":"save","key":"k"},"malformed",{"id":"future","key":"q","ctrl":false,"alt":false,"shift":false}]}"#,
        )
        .unwrap();
        assert_eq!(settings.editor_hotkeys.len(), 1);
        assert_eq!(settings.editor_hotkeys[0].id, "future");

        let serialized = serde_json::to_value(AppSettings::default()).unwrap();
        assert_eq!(serialized["editorHotkeys"], serde_json::json!([]));
    }

    #[test]
    fn editor_hotkey_overrides_round_trip() {
        let settings = parse_settings_json(
            r#"{"editorHotkeys":[{"id":"save","key":"k","ctrl":true,"alt":false,"shift":true}]}"#,
        )
        .unwrap();
        assert_eq!(
            settings.editor_hotkeys,
            vec![EditorHotkeyOverride {
                id: "save".into(),
                key: "k".into(),
                ctrl: true,
                alt: false,
                shift: true,
            }]
        );
    }

    #[test]
    fn default_translation_provider_is_openai_compatible() {
        let settings = AppSettings::default();
        assert_eq!(
            settings.default_translation_provider_id.as_deref(),
            Some("default-provider")
        );
        assert_eq!(
            settings.translation_providers,
            vec![TranslationProviderSettings::default()]
        );
        let serialized = serde_json::to_value(settings).unwrap();
        assert_eq!(serialized["translationProviders"][0]["apiKey"], "");
        assert_eq!(
            serialized["defaultTranslationProviderId"],
            serde_json::Value::String(DEFAULT_PROVIDER_ID.into())
        );
    }

    #[test]
    fn migrates_untouched_keyless_legacy_translation_settings() {
        let settings = parse_settings_json(
            r#"{"translationBaseUrl":"https://api.openai.com/v1","translationModel":"gpt-4o-mini"}"#,
        )
        .unwrap();
        let provider = &settings.translation_providers[0];

        assert_eq!(provider.name, "OpenAI");
        assert_eq!(provider.api_type, TranslationApiType::OpenaiCompatible);
        assert_eq!(provider.base_url, DEFAULT_OPENAI_BASE_URL);
        assert_eq!(provider.model, DEFAULT_OPENAI_MODEL);
        assert_eq!(provider.api_key, "");
        assert_eq!(provider.max_concurrency, 1);
        assert_eq!(provider.requests_per_minute, 10);
        assert_eq!(
            settings.default_translation_provider_id.as_deref(),
            Some(DEFAULT_PROVIDER_ID)
        );
    }

    #[test]
    fn migrates_customized_legacy_translation_settings_without_losing_secret() {
        let settings = parse_settings_json(
            r#"{"translationBaseUrl":"https://proxy.example.invalid/api","translationModel":"synthetic-model","translationApiKey":"synthetic-test-key"}"#,
        )
        .unwrap();
        let provider = &settings.translation_providers[0];

        assert_eq!(provider.name, "默认供应商");
        assert_eq!(provider.base_url, "https://proxy.example.invalid/api");
        assert_eq!(provider.model, "synthetic-model");
        assert_eq!(provider.api_key, "synthetic-test-key");
    }

    #[test]
    fn custom_keyless_legacy_translation_settings_use_generic_name() {
        let settings = parse_settings_json(
            r#"{"translationBaseUrl":"http://localhost:11434/v1","translationModel":"synthetic-local-model"}"#,
        )
        .unwrap();

        assert_eq!(settings.translation_providers[0].name, "默认供应商");
        assert_eq!(settings.translation_providers[0].api_key, "");
    }

    #[test]
    fn present_new_provider_array_wins_over_stale_legacy_fields() {
        let settings = parse_settings_json(
            r#"{
                "translationProviders": [],
                "defaultTranslationProviderId": "stale",
                "translationBaseUrl": "https://legacy.example.invalid/v1",
                "translationModel": "legacy-model",
                "translationApiKey": "synthetic-legacy-key"
            }"#,
        )
        .unwrap();

        assert!(settings.translation_providers.is_empty());
        assert_eq!(settings.default_translation_provider_id, None);
        let serialized = serde_json::to_value(&settings).unwrap();
        assert!(serialized.get("translationBaseUrl").is_none());
        assert!(serialized.get("translationModel").is_none());
        assert!(serialized.get("translationApiKey").is_none());
        assert!(serialized.get("defaultTranslationProviderId").is_none());
    }

    #[test]
    fn normalizes_provider_limits_keys_and_default_id() {
        let settings = parse_settings_json(
            r#"{
                "translationProviders": [
                    {
                        "id": "first",
                        "name": "",
                        "apiType": "gemini",
                        "baseUrl": "",
                        "apiKey": "  ",
                        "model": "",
                        "maxConcurrency": -9,
                        "requestsPerMinute": 999
                    }
                ],
                "defaultTranslationProviderId": "missing"
            }"#,
        )
        .unwrap();
        let provider = &settings.translation_providers[0];

        assert_eq!(provider.max_concurrency, 1);
        assert_eq!(provider.requests_per_minute, 100);
        assert_eq!(provider.api_key, "");
        assert_eq!(
            settings.default_translation_provider_id.as_deref(),
            Some("first")
        );
        assert_eq!(provider.name, "");
        assert_eq!(provider.base_url, "");
        assert_eq!(provider.model, "");
    }

    #[test]
    fn new_format_round_trip_does_not_remigrate() {
        let mut original = AppSettings::default();
        original.translation_providers[0].name = "Synthetic Provider".into();
        original.translation_providers[0].model = "synthetic-model".into();
        let json = serde_json::to_string(&original).unwrap();
        let loaded = parse_settings_json(&json).unwrap();

        assert_eq!(loaded.translation_providers[0].name, "Synthetic Provider");
        assert_eq!(loaded.translation_providers[0].model, "synthetic-model");
    }

    #[test]
    fn legacy_runtime_source_modes_deserialize_as_official() {
        for mode in ["auto", "custom", "unknown-mode"] {
            let json = format!(
                r#"{{"runtimeSourceMode":"{mode}","asrEngine":"faster-whisper","asrModel":"large-v3","asrDevice":"auto","translationBaseUrl":"https://api.openai.com/v1","translationModel":"gpt-4o-mini","defaultSourceLang":"ja","defaultTargetLang":"zh-CN","translationBatchSize":25,"translationContextWindow":2,"subtitleMergeMode":"inline"}}"#
            );
            let settings: AppSettings = serde_json::from_str(&json).unwrap();
            assert_eq!(
                settings.runtime_source_mode,
                RuntimeDependencySourceMode::Official,
                "mode={mode}"
            );
        }
    }

    #[test]
    fn china_runtime_source_mode_deserializes() {
        let json = r#"{"runtimeSourceMode":"china","asrEngine":"faster-whisper","asrModel":"large-v3","asrDevice":"auto","translationBaseUrl":"https://api.openai.com/v1","translationModel":"gpt-4o-mini","defaultSourceLang":"ja","defaultTargetLang":"zh-CN","translationBatchSize":25,"translationContextWindow":2,"subtitleMergeMode":"inline"}"#;
        let settings: AppSettings = serde_json::from_str(json).unwrap();
        assert_eq!(
            settings.runtime_source_mode,
            RuntimeDependencySourceMode::China
        );
    }

    #[test]
    fn deprecated_runtime_source_fields_are_ignored_on_load() {
        let json = r#"{"runtimeSourceMode":"official","runtimeRecommendedProfile":"china","runtimeRecommendationCheckedAt":"123","runtimeCustomSource":{"ffmpegUrl":"https://example.com/ffmpeg.zip"},"asrEngine":"faster-whisper","asrModel":"large-v3","asrDevice":"auto","translationBaseUrl":"https://api.openai.com/v1","translationModel":"gpt-4o-mini","defaultSourceLang":"ja","defaultTargetLang":"zh-CN","translationBatchSize":25,"translationContextWindow":2,"subtitleMergeMode":"inline"}"#;
        let settings: AppSettings = serde_json::from_str(json).unwrap();
        let serialized = serde_json::to_value(&settings).unwrap();
        assert!(serialized.get("runtimeRecommendedProfile").is_none());
        assert!(serialized.get("runtimeRecommendationCheckedAt").is_none());
        assert!(serialized.get("runtimeCustomSource").is_none());
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

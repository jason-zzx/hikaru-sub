use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

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
        }
    }
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("settings.json"))
}

pub fn load_settings(app: &AppHandle) -> Result<AppSettings, String> {
    let path = settings_path(app)?;
    if !path.exists() {
        return Ok(AppSettings::default());
    }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
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

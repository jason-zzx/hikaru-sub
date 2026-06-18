use crate::settings::load_settings;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AsrConfig {
    pub engine: String,
    pub model: String,
    pub device: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationConfig {
    pub provider: String,
    pub base_url: String,
    pub model: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMeta {
    pub version: u32,
    pub video_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub audio_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ass_path: Option<String>,
    pub source_lang: String,
    pub target_lang: String,
    pub asr: AsrConfig,
    pub translation: TranslationConfig,
}

fn project_dir_for_video(video_path: &Path) -> Result<PathBuf, String> {
    let parent = video_path
        .parent()
        .ok_or_else(|| "无法解析视频所在目录".to_string())?;
    Ok(parent.join(".hikaru"))
}

fn project_json_path(dir: &Path) -> PathBuf {
    dir.join("project.json")
}

fn default_project(video_path: &str, settings: &crate::settings::AppSettings) -> ProjectMeta {
    ProjectMeta {
        version: 1,
        video_path: video_path.to_string(),
        audio_path: None,
        ass_path: None,
        source_lang: "ja".into(),
        target_lang: settings.default_target_lang.clone(),
        asr: AsrConfig {
            engine: settings.asr_engine.clone(),
            model: settings.asr_model.clone(),
            device: settings.asr_device.clone(),
        },
        translation: TranslationConfig {
            provider: "openai-compatible".into(),
            base_url: settings.translation_base_url.clone(),
            model: settings.translation_model.clone(),
            temperature: Some(0.3),
        },
    }
}

#[tauri::command]
pub fn create_project(app: tauri::AppHandle, video_path: String) -> Result<ProjectMeta, String> {
    let video = PathBuf::from(&video_path);
    if !video.is_file() {
        return Err(format!("视频文件不存在: {video_path}"));
    }

    let dir = project_dir_for_video(&video)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let settings = load_settings(&app)?;
    let mut project = default_project(&video_path, &settings);
    let audio_path = dir.join("audio.wav");
    let ass_path = dir.join("subtitles.ass");
    project.audio_path = Some(audio_path.to_string_lossy().into_owned());
    project.ass_path = Some(ass_path.to_string_lossy().into_owned());

    let json = serde_json::to_string_pretty(&project).map_err(|e| e.to_string())?;
    fs::write(project_json_path(&dir), json).map_err(|e| e.to_string())?;

    Ok(project)
}

#[tauri::command]
pub fn path_exists(path: String) -> bool {
    PathBuf::from(path).exists()
}

#[tauri::command]
pub fn open_project(project_dir: String) -> Result<ProjectMeta, String> {
    let dir = PathBuf::from(&project_dir);
    let json_path = project_json_path(&dir);
    if !json_path.is_file() {
        return Err(format!("项目文件不存在: {}", json_path.display()));
    }
    let content = fs::read_to_string(json_path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoSession {
    pub video_path: String,
    pub workspace_path: String,
    pub audio_path: String,
    pub transcribed_ass_path: String,
    pub translated_ass_path: String,
    pub burn_ass_path: String,
    pub source_lang: String,
}

fn video_stem(video_path: &Path) -> Result<String, String> {
    video_path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .filter(|stem| !stem.trim().is_empty())
        .map(|stem| stem.to_string())
        .ok_or_else(|| "无法解析视频文件名".to_string())
}

fn workspace_key_for_video(video_path: &Path) -> Result<String, String> {
    let canonical = video_path
        .canonicalize()
        .map_err(|e| format!("无法解析视频绝对路径: {e}"))?;
    let normalized = canonical.to_string_lossy().replace('\\', "/");
    let mut hasher = Sha256::new();
    hasher.update(normalized.as_bytes());
    Ok(hex::encode(hasher.finalize()))
}

fn path_to_display_string(path: &Path) -> String {
    path.to_string_lossy()
        .trim_start_matches(r"\\?\")
        .to_string()
}

fn build_video_session(video_path: &Path, cache_root: &Path) -> Result<VideoSession, String> {
    if !video_path.is_file() {
        return Err(format!("视频文件不存在: {}", video_path.display()));
    }

    let canonical_video = video_path
        .canonicalize()
        .map_err(|e| format!("无法解析视频绝对路径: {e}"))?;
    let parent = canonical_video
        .parent()
        .ok_or_else(|| "无法解析视频所在目录".to_string())?;
    let stem = video_stem(&canonical_video)?;
    let workspace = cache_root
        .join("workspace")
        .join(workspace_key_for_video(&canonical_video)?);

    Ok(VideoSession {
        video_path: path_to_display_string(&canonical_video),
        workspace_path: path_to_display_string(&workspace),
        audio_path: path_to_display_string(&workspace.join("audio.wav")),
        transcribed_ass_path: path_to_display_string(
            &parent.join(format!("{stem}.transcribed.ass")),
        ),
        translated_ass_path: path_to_display_string(
            &parent.join(format!("{stem}.translated.ass")),
        ),
        burn_ass_path: path_to_display_string(&workspace.join("burn.input.ass")),
        source_lang: "ja".into(),
    })
}

#[tauri::command]
pub fn prepare_video_session(
    app: tauri::AppHandle,
    video_path: String,
) -> Result<VideoSession, String> {
    let video = PathBuf::from(&video_path);
    let cache_root = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("无法读取应用缓存目录: {e}"))?;
    let session = build_video_session(&video, &cache_root)?;
    fs::create_dir_all(&session.workspace_path)
        .map_err(|e| format!("无法创建缓存工作目录: {e}"))?;
    Ok(session)
}

#[tauri::command]
pub fn path_exists(path: String) -> bool {
    PathBuf::from(path).exists()
}

fn is_cached_audio_path(cache_root: &Path, audio_path: &Path) -> Result<bool, String> {
    if audio_path.file_name().and_then(|name| name.to_str()) != Some("audio.wav") {
        return Ok(false);
    }

    let workspace_root = cache_root.join("workspace");
    let Some(audio_parent) = audio_path.parent().filter(|parent| parent.is_dir()) else {
        return Ok(false);
    };

    let canonical_workspace_root = workspace_root
        .canonicalize()
        .map_err(|e| format!("无法解析缓存目录: {e}"))?;
    let canonical_audio_parent = audio_parent
        .canonicalize()
        .map_err(|e| format!("无法解析音频缓存目录: {e}"))?;

    Ok(canonical_audio_parent.parent() == Some(canonical_workspace_root.as_path()))
}

#[tauri::command]
pub fn delete_cached_audio(app: tauri::AppHandle, audio_path: String) -> Result<bool, String> {
    let path = PathBuf::from(&audio_path);
    if !path.exists() {
        return Ok(false);
    }

    let cache_root = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("无法读取应用缓存目录: {e}"))?;
    if !is_cached_audio_path(&cache_root, &path)? {
        return Err("拒绝删除非会话音频缓存文件".into());
    }

    fs::remove_file(&path).map_err(|e| format!("删除音频缓存失败: {e}"))?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_video_session_derives_visible_subtitle_paths_and_cache_workspace() {
        let temp = tempfile::tempdir().unwrap();
        let cache = tempfile::tempdir().unwrap();
        let video_path = temp.path().join("episode.01.mp4");
        fs::write(&video_path, b"video").unwrap();

        let session = build_video_session(&video_path, cache.path()).unwrap();

        assert_eq!(
            session.video_path,
            path_to_display_string(&video_path.canonicalize().unwrap())
        );
        assert_eq!(
            session.transcribed_ass_path,
            temp.path()
                .join("episode.01.transcribed.ass")
                .to_string_lossy()
        );
        assert_eq!(
            session.translated_ass_path,
            temp.path()
                .join("episode.01.translated.ass")
                .to_string_lossy()
        );
        assert!(session
            .audio_path
            .ends_with(&format!("{}audio.wav", std::path::MAIN_SEPARATOR)));
        assert!(session
            .burn_ass_path
            .ends_with(&format!("{}burn.input.ass", std::path::MAIN_SEPARATOR)));
        assert!(Path::new(&session.workspace_path).starts_with(cache.path()));

        let legacy_hidden_dir = format!(".{}", "hikaru");
        assert!(!temp.path().join(legacy_hidden_dir).exists());
    }

    #[test]
    fn build_video_session_uses_distinct_cache_workspace_for_same_file_name() {
        let root = tempfile::tempdir().unwrap();
        let cache = tempfile::tempdir().unwrap();
        let dir_a = root.path().join("a");
        let dir_b = root.path().join("b");
        fs::create_dir_all(&dir_a).unwrap();
        fs::create_dir_all(&dir_b).unwrap();
        let video_a = dir_a.join("episode.mp4");
        let video_b = dir_b.join("episode.mp4");
        fs::write(&video_a, b"a").unwrap();
        fs::write(&video_b, b"b").unwrap();

        let session_a = build_video_session(&video_a, cache.path()).unwrap();
        let session_b = build_video_session(&video_b, cache.path()).unwrap();

        assert_ne!(session_a.workspace_path, session_b.workspace_path);
        assert_eq!(
            session_a.transcribed_ass_path,
            dir_a.join("episode.transcribed.ass").to_string_lossy()
        );
        assert_eq!(
            session_b.transcribed_ass_path,
            dir_b.join("episode.transcribed.ass").to_string_lossy()
        );
    }

    #[test]
    fn build_video_session_uses_canonical_video_path_for_workspace_key() {
        let temp = tempfile::tempdir().unwrap();
        let cache = tempfile::tempdir().unwrap();
        let nested = temp.path().join("nested");
        fs::create_dir_all(&nested).unwrap();
        let video_path = nested.join("episode.mp4");
        fs::write(&video_path, b"video").unwrap();

        let direct = build_video_session(&video_path, cache.path()).unwrap();
        let with_parent_segment = nested.join("..").join("nested").join("episode.mp4");
        let normalized = build_video_session(&with_parent_segment, cache.path()).unwrap();

        assert_eq!(direct.video_path, normalized.video_path);
        assert_eq!(direct.workspace_path, normalized.workspace_path);
    }

    #[test]
    fn cached_audio_path_must_be_audio_wav_under_workspace() {
        let cache = tempfile::tempdir().unwrap();
        let workspace = cache.path().join("workspace").join("abc");
        fs::create_dir_all(&workspace).unwrap();

        assert!(is_cached_audio_path(cache.path(), &workspace.join("audio.wav")).unwrap());
        assert!(!is_cached_audio_path(cache.path(), &workspace.join("other.wav")).unwrap());
        assert!(!is_cached_audio_path(cache.path(), &cache.path().join("audio.wav")).unwrap());
    }
}

use std::path::Path;
use tauri::AppHandle;

fn write_ass_text_to_path(path: &Path, ass_text: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() && !parent.is_dir() {
            return Err(format!("ASS 文件目录不存在: {}", parent.display()));
        }
    }
    std::fs::write(path, ass_text).map_err(|e| format!("写入 ASS 文件失败: {}", e))
}

/// 保存 ASS 文本到文件
#[tauri::command]
pub async fn save_ass_text(
    _app: AppHandle,
    ass_path: String,
    ass_text: String,
) -> Result<(), String> {
    let path = Path::new(&ass_path);
    write_ass_text_to_path(path, &ass_text)
}

/// 加载 ASS 文件内容
#[tauri::command]
pub async fn load_ass_text(_app: AppHandle, ass_path: String) -> Result<String, String> {
    if !Path::new(&ass_path).exists() {
        return Err("ASS 文件不存在".to_string());
    }
    std::fs::read_to_string(&ass_path).map_err(|e| format!("读取 ASS 文件失败: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn write_ass_text_requires_existing_parent_directory() {
        let temp = tempfile::tempdir().unwrap();
        let target = temp.path().join("missing").join("episode.transcribed.ass");

        let err = write_ass_text_to_path(&target, "[Script Info]").unwrap_err();

        assert!(err.contains("ASS 文件目录不存在"));
        assert!(!target.exists());
    }
}

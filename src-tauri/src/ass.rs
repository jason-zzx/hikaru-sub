use std::path::Path;
use tauri::AppHandle;

/// 保存 ASS 文本到文件
#[tauri::command]
pub async fn save_ass_text(
    _app: AppHandle,
    ass_path: String,
    ass_text: String,
) -> Result<(), String> {
    let path = Path::new(&ass_path);
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("创建 ASS 目录失败: {}", e))?;
        }
    }
    std::fs::write(path, ass_text).map_err(|e| format!("写入 ASS 文件失败: {}", e))?;
    Ok(())
}

/// 加载 ASS 文件内容
#[tauri::command]
pub async fn load_ass_text(_app: AppHandle, ass_path: String) -> Result<String, String> {
    if !Path::new(&ass_path).exists() {
        return Err("ASS 文件不存在".to_string());
    }
    std::fs::read_to_string(&ass_path).map_err(|e| format!("读取 ASS 文件失败: {}", e))
}

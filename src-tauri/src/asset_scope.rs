use tauri::{AppHandle, Manager};
use std::path::Path;

#[tauri::command]
pub fn allow_asset_path(app: AppHandle, path: String) -> Result<(), String> {
    println!("allow_asset_path called with: {}", path);

    // 获取文件所在目录
    let path_obj = Path::new(&path);
    let dir = path_obj
        .parent()
        .ok_or("无法获取父目录")?
        .to_str()
        .ok_or("路径包含无效字符")?;

    println!("Adding directory to asset scope: {}", dir);

    // 添加目录到 asset protocol scope
    app.asset_protocol_scope()
        .allow_directory(dir, true)
        .map_err(|e| format!("添加到 asset scope 失败: {}", e))?;

    println!("Successfully added to asset scope");
    Ok(())
}

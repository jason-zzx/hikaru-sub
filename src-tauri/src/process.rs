use std::ffi::OsStr;
use std::process::{Command, Stdio};

#[cfg(windows)]
pub const CREATE_NO_WINDOW: u32 = 0x08000000;

#[cfg(not(windows))]
pub const CREATE_NO_WINDOW: u32 = 0;

pub fn hidden_command<S: AsRef<OsStr>>(program: S) -> Command {
    let mut command = Command::new(program);
    hide_window(&mut command);
    command
}

pub fn hide_window(command: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

/// Best-effort, idempotent process-tree termination shared by ASR jobs.
pub fn terminate_process_tree(pid: u32) {
    if pid == 0 {
        return;
    }
    if cfg!(windows) {
        let _ = hidden_command("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    } else {
        let group = format!("-{pid}");
        let group_status = hidden_command("kill")
            .args(["-TERM", &group])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
        if !group_status.map(|status| status.success()).unwrap_or(false) {
            let _ = hidden_command("kill")
                .args(["-TERM", &pid.to_string()])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(windows)]
    #[test]
    fn windows_create_no_window_flag_matches_winapi_value() {
        assert_eq!(CREATE_NO_WINDOW, 0x08000000);
    }

    #[cfg(not(windows))]
    #[test]
    fn non_windows_create_no_window_flag_is_noop() {
        assert_eq!(CREATE_NO_WINDOW, 0);
    }
}

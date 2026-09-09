//! Windows lifetime ownership for the full-CLI worker. No new job server.
//! The host assigns the suspended worker before any application code can run;
//! descendants inherit membership and host death closes the non-inherited handle.
use std::ffi::c_void;
use std::os::windows::io::AsRawHandle;
use std::process::Child;
use std::time::{Duration, Instant};

type Handle = *mut c_void;
#[link(name = "kernel32")]
extern "system" {
    fn CreateJobObjectW(attributes: *const c_void, name: *const u16) -> Handle;
    fn SetInformationJobObject(job: Handle, class: u32, info: *const c_void, size: u32) -> i32;
    fn QueryInformationJobObject(
        job: Handle,
        class: u32,
        info: *mut c_void,
        size: u32,
        returned: *mut u32,
    ) -> i32;
    fn AssignProcessToJobObject(job: Handle, process: Handle) -> i32;
    fn TerminateJobObject(job: Handle, code: u32) -> i32;
    fn CloseHandle(handle: Handle) -> i32;
}
#[link(name = "ntdll")]
extern "system" {
    fn NtResumeProcess(process: Handle) -> i32;
}

pub(crate) struct WorkerJob {
    handle: usize,
    #[cfg(test)]
    pub(crate) fail_reap: std::sync::atomic::AtomicBool,
}
impl WorkerJob {
    pub(crate) fn new() -> Result<Self, String> {
        // JOBOBJECT_EXTENDED_LIMIT_INFORMATION x64, identical to the reviewed
        // native fixture/smoke layout. No breakaway flags, handle not inherited.
        const _: () = assert!(std::mem::size_of::<usize>() == 8);
        unsafe {
            let job = Self {
                handle: CreateJobObjectW(std::ptr::null(), std::ptr::null()) as usize,
                #[cfg(test)]
                fail_reap: std::sync::atomic::AtomicBool::new(false),
            };
            let mut info = [0u64; 18];
            info[2] = 0x2000; // BasicLimitInformation.LimitFlags: KILL_ON_JOB_CLOSE
            if job.handle == 0
                || SetInformationJobObject(job.handle(), 9, info.as_ptr().cast(), 144) == 0
            {
                return Err("[worker_job_failed] 无法建立 ASR 进程生命周期".into());
            }
            Ok(job)
        }
    }
    fn handle(&self) -> Handle {
        self.handle as Handle
    }
    pub(crate) fn attach_and_resume(&self, child: &mut Child) -> Result<(), String> {
        unsafe {
            if AssignProcessToJobObject(self.handle(), child.as_raw_handle()) != 0
                && NtResumeProcess(child.as_raw_handle()) == 0
            {
                return Ok(());
            }
        }
        // The caller retains the Child and confirms termination on every error,
        // including assignment failure before it belongs to this Job.
        Err("[worker_job_failed] 无法约束 ASR 进程生命周期".into())
    }
    pub(crate) fn terminate(&self) {
        unsafe {
            TerminateJobObject(self.handle(), 20);
        }
    }
    pub(crate) fn active(&self) -> Result<u32, String> {
        let mut info = [0u64; 6]; // JOBOBJECT_BASIC_ACCOUNTING_INFORMATION, aligned
        unsafe {
            if QueryInformationJobObject(
                self.handle(),
                1,
                info.as_mut_ptr().cast(),
                48,
                std::ptr::null_mut(),
            ) == 0
            {
                return Err("[worker_job_failed] 无法验证 ASR 子进程退出".into());
            }
        }
        Ok(info[5] as u32) // ActiveProcesses at byte 40
    }
    pub(crate) fn reap(&self, timeout: Duration) -> Result<(), String> {
        #[cfg(test)]
        if self.fail_reap.load(std::sync::atomic::Ordering::Relaxed) {
            return Err("[worker_job_failed] 无法验证 ASR 子进程退出".into());
        }
        self.terminate();
        let start = Instant::now();
        while self.active()? != 0 {
            if start.elapsed() >= timeout {
                return Err("[worker_termination_timeout] ASR 子进程未退出".into());
            }
            std::thread::sleep(Duration::from_millis(1));
        }
        Ok(())
    }
}
impl Drop for WorkerJob {
    fn drop(&mut self) {
        unsafe {
            if self.handle != 0 {
                CloseHandle(self.handle());
            }
        }
    }
}

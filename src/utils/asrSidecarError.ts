/** 判断 ASR sidecar 启动/连接错误是否表示引擎依赖尚未安装。 */
export function isAsrEngineNotInstalledError(error: unknown): boolean {
  const message = String(error);
  return (
    message.includes("请检查 Python 依赖是否已安装") ||
    message.includes("sidecar 未输出就绪端口") ||
    /ModuleNotFoundError|No module named/i.test(message)
  );
}

export const ASR_ENGINE_NOT_INSTALLED_LABEL = "ASR 引擎未安装";

export const ASR_ENGINE_NOT_INSTALLED_HINT =
  "请先在设置中点击「配置当前引擎依赖」完成安装。";

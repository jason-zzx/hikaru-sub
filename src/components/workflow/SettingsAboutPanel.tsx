import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { BrandMark } from "../brand/BrandMark";
import { Button } from "../ui/button";
import {
  APP_DISPLAY_NAME,
  APP_GITHUB_LICENSE_URL,
  APP_GITHUB_URL,
  APP_LICENSE_LABEL,
  APP_SHORT_DESCRIPTION,
} from "../../constants/about";
import { compareSemver } from "../../services/appUpdate";
import { fetchLatestGithubRelease } from "../../services/tauri";
import { SettingsSection } from "./settingsForm";

type UpdateMessage = { kind: "ok" | "error" | "info"; text: string };

export function SettingsAboutPanel() {
  const [version, setVersion] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [updateMessage, setUpdateMessage] = useState<UpdateMessage | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    void getVersion()
      .then((value) => {
        if (!cancelled) setVersion(value);
      })
      .catch(() => {
        if (!cancelled) setVersion(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleCheckUpdate = async () => {
    if (checking) return;
    setChecking(true);
    setUpdateMessage(null);
    try {
      const currentVersion = await getVersion();
      setVersion(currentVersion);
      const latest = await fetchLatestGithubRelease();
      if (compareSemver(currentVersion, latest.version) < 0) {
        setUpdateMessage({
          kind: "info",
          text: `发现新版本 ${latest.version}（当前 ${currentVersion}）`,
        });
        try {
          await openUrl(latest.htmlUrl);
        } catch {
          // Message already explains; user can open the GitHub link manually.
        }
        return;
      }
      setUpdateMessage({
        kind: "ok",
        text: `已是最新版本（${currentVersion}）`,
      });
    } catch (e) {
      setUpdateMessage({
        kind: "error",
        text: `检查更新失败：${e instanceof Error ? e.message : String(e)}`,
      });
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <section className="flex items-start gap-4">
        <BrandMark className="size-14" />
        <div className="min-w-0">
          <h3 className="text-lg font-semibold text-text">{APP_DISPLAY_NAME}</h3>
          <p className="mt-1 text-sm leading-relaxed text-text-muted">
            {APP_SHORT_DESCRIPTION}
          </p>
        </div>
      </section>

      <SettingsSection title="版本与更新">
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-text">
            当前版本：
            <span className="font-medium tabular-nums">
              {version ?? "读取中…"}
            </span>
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={checking}
            onClick={() => {
              void handleCheckUpdate();
            }}
          >
            {checking ? "检查中…" : "检查更新"}
          </Button>
        </div>
        {updateMessage ? (
          <p
            className={`text-sm break-words ${
              updateMessage.kind === "ok"
                ? "text-success"
                : updateMessage.kind === "error"
                  ? "text-danger"
                  : "text-text-muted"
            }`}
          >
            {updateMessage.text}
          </p>
        ) : null}
      </SettingsSection>

      <SettingsSection title="项目信息">
        <dl className="flex flex-col gap-3 text-sm">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-3">
            <dt className="shrink-0 text-text-muted">GitHub</dt>
            <dd className="min-w-0">
              <button
                type="button"
                className="text-left text-primary underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                onClick={() => {
                  void openUrl(APP_GITHUB_URL).catch(() => {
                    setUpdateMessage({
                      kind: "error",
                      text: "无法打开 GitHub 页面，请稍后重试",
                    });
                  });
                }}
              >
                {APP_GITHUB_URL.replace(/^https:\/\//, "")}
              </button>
            </dd>
          </div>
          <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-3">
            <dt className="shrink-0 text-text-muted">许可证</dt>
            <dd className="min-w-0">
              <button
                type="button"
                className="text-left text-primary underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                onClick={() => {
                  void openUrl(APP_GITHUB_LICENSE_URL).catch(() => {
                    setUpdateMessage({
                      kind: "error",
                      text: "无法打开许可证页面，请稍后重试",
                    });
                  });
                }}
              >
                {APP_LICENSE_LABEL}
              </button>
            </dd>
          </div>
        </dl>
      </SettingsSection>
    </div>
  );
}

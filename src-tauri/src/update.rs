use reqwest::header::LOCATION;
use reqwest::redirect::Policy;
use serde::Serialize;
use url::Url;

const LATEST_RELEASE_URL: &str = "https://github.com/jason-zzx/hikaru-sub/releases/latest";
const USER_AGENT: &str = "hikaru-sub";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LatestGithubRelease {
    /// SemVer without a leading `v`.
    pub version: String,
    pub html_url: String,
}

/// Extract `vX.Y.Z` / `X.Y.Z` from a GitHub release tag URL.
pub(crate) fn parse_version_from_release_url(release_url: &str) -> Result<String, String> {
    let parsed = Url::parse(release_url).map_err(|e| format!("无效的发布地址: {e}"))?;
    let tag = parsed
        .path()
        .rsplit_once("/releases/tag/")
        .map(|(_, tag)| tag.trim().trim_start_matches(['v', 'V']))
        .filter(|tag| !tag.is_empty())
        .ok_or_else(|| "无法从发布地址解析版本号".to_string())?;
    Ok(tag.to_string())
}

pub(crate) async fn resolve_latest_release_html_url(
    client: &reqwest::Client,
    latest_url: &str,
) -> Result<String, String> {
    let base = Url::parse(latest_url).map_err(|e| format!("无效的发布页地址: {e}"))?;
    let response = client
        .head(latest_url)
        .send()
        .await
        .map_err(|e| format!("请求 GitHub 发布页失败: {e}"))?;

    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Err("尚未发布正式版本".to_string());
    }
    if !response.status().is_redirection() {
        return Err("无法解析最新发布版本".to_string());
    }

    let location = response
        .headers()
        .get(LOCATION)
        .ok_or_else(|| "GitHub 未返回重定向地址".to_string())?
        .to_str()
        .map_err(|_| "GitHub 重定向地址无效".to_string())?;
    let target = base
        .join(location)
        .map_err(|e| format!("无效的重定向地址: {e}"))?;
    Ok(target.into())
}

#[tauri::command]
pub async fn fetch_latest_github_release() -> Result<LatestGithubRelease, String> {
    let client = reqwest::Client::builder()
        .redirect(Policy::none())
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {e}"))?;

    let html_url = resolve_latest_release_html_url(&client, LATEST_RELEASE_URL).await?;
    let version = parse_version_from_release_url(&html_url)?;
    Ok(LatestGithubRelease { version, html_url })
}

#[cfg(test)]
mod tests {
    use super::*;
    use httpmock::Method::HEAD;
    use httpmock::MockServer;

    #[test]
    fn parses_tag_urls() {
        assert_eq!(
            parse_version_from_release_url(
                "https://github.com/jason-zzx/hikaru-sub/releases/tag/v0.2.0"
            )
            .unwrap(),
            "0.2.0"
        );
        assert_eq!(
            parse_version_from_release_url(
                "https://github.com/jason-zzx/hikaru-sub/releases/tag/0.3.1"
            )
            .unwrap(),
            "0.3.1"
        );
    }

    #[test]
    fn rejects_non_tag_release_urls() {
        assert!(
            parse_version_from_release_url("https://github.com/jason-zzx/hikaru-sub/releases")
                .is_err()
        );
        assert!(parse_version_from_release_url(
            "https://github.com/jason-zzx/hikaru-sub/releases/latest"
        )
        .is_err());
    }

    #[tokio::test]
    async fn resolves_version_from_head_redirect() {
        let server = MockServer::start();
        let tag_url = "https://github.com/jason-zzx/hikaru-sub/releases/tag/v0.2.0";
        let _mock = server.mock(|when, then| {
            when.method(HEAD).path("/releases/latest");
            then.status(302).header("Location", tag_url);
        });

        let client = reqwest::Client::builder()
            .redirect(Policy::none())
            .user_agent(USER_AGENT)
            .build()
            .unwrap();

        let html_url = resolve_latest_release_html_url(&client, &server.url("/releases/latest"))
            .await
            .unwrap();
        assert_eq!(html_url, tag_url);
        assert_eq!(parse_version_from_release_url(&html_url).unwrap(), "0.2.0");
    }
}

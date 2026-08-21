//! Chrome DevTools Protocol client for Obscura headless browser

use serde_json::{json, Value};
use base64::Engine;
use anyhow::Result;

/// Obscura CDP Client - connects to headless browser via Chrome DevTools Protocol
pub struct ObscuraClient {
    cdp_url: String,
    http_client: reqwest::Client,
}

impl ObscuraClient {
    /// Create new CDP client pointing to Obscura server
    pub fn new(cdp_url: &str) -> Self {
        Self {
            cdp_url: cdp_url.to_string(),
            http_client: reqwest::Client::new(),
        }
    }

    /// Create a new browser page
    pub async fn create_page(&self) -> Result<PageContext> {
        let response = self.http_client
            .post(&format!("{}/json/new", self.cdp_url))
            .send()
            .await?;

        let data: Value = response.json().await?;

        Ok(PageContext {
            client: self.http_client.clone(),
            cdp_url: self.cdp_url.clone(),
            page_id: data["id"].as_str().unwrap_or("unknown").to_string(),
            ws_url: data["webSocketDebuggerUrl"].as_str().unwrap_or("").to_string(),
        })
    }

    /// List active pages
    pub async fn list_pages(&self) -> Result<Vec<Value>> {
        let response = self.http_client
            .get(&format!("{}/json", self.cdp_url))
            .send()
            .await?;

        Ok(response.json().await?)
    }

    /// Get version info
    pub async fn version(&self) -> Result<Value> {
        let response = self.http_client
            .get(&format!("{}/json/version", self.cdp_url))
            .send()
            .await?;

        Ok(response.json().await?)
    }
}

/// Single page context in Obscura
pub struct PageContext {
    client: reqwest::Client,
    cdp_url: String,
    pub page_id: String,
    pub ws_url: String,
}

impl PageContext {
    /// Navigate to URL
    pub async fn navigate(&self, url: &str) -> Result<()> {
        self.client
            .post(&format!("{}/json/pageCommand", self.cdp_url))
            .json(&json!({
                "id": self.page_id,
                "command": "Page.navigate",
                "url": url,
                "waitUntil": "networkIdle0"
            }))
            .send()
            .await?;

        Ok(())
    }

    /// Evaluate JavaScript on the page
    pub async fn evaluate(&self, js: &str) -> Result<Value> {
        let response = self.client
            .post(&format!("{}/json/pageCommand", self.cdp_url))
            .json(&json!({
                "id": self.page_id,
                "command": "Runtime.evaluate",
                "expression": js,
                "returnByValue": true
            }))
            .send()
            .await?;

        Ok(response.json().await?)
    }

    /// Get page content (HTML)
    pub async fn get_content(&self) -> Result<String> {
        let response = self.evaluate("document.documentElement.outerHTML").await?;
        Ok(response["result"]["value"]
            .as_str()
            .unwrap_or("")
            .to_string())
    }

    /// Screenshot page
    pub async fn screenshot(&self, format: &str) -> Result<Vec<u8>> {
        let response = self.client
            .post(&format!("{}/json/pageCommand", self.cdp_url))
            .json(&json!({
                "id": self.page_id,
                "command": "Page.captureScreenshot",
                "format": format,
                "fromSurface": true
            }))
            .send()
            .await?;

        let data: Value = response.json().await?;
        let base64_data = data["result"]["data"].as_str().unwrap_or("");
        Ok(base64::engine::general_purpose::STANDARD.decode(base64_data)?)
    }

    /// Wait for selector
    pub async fn wait_for_selector(&self, selector: &str, timeout_ms: u32) -> Result<bool> {
        let js = format!(
            r#"
            new Promise((resolve) => {{
                const timeout = setTimeout(() => resolve(false), {});
                const check = () => {{
                    if (document.querySelector('{}')) {{
                        clearTimeout(timeout);
                        resolve(true);
                    }} else {{
                        requestAnimationFrame(check);
                    }}
                }};
                check();
            }})
            "#,
            timeout_ms, selector
        );

        let response = self.evaluate(&js).await?;
        Ok(response["result"]["value"].as_bool().unwrap_or(false))
    }

    /// Click on element
    pub async fn click(&self, selector: &str) -> Result<()> {
        let js = format!(
            "document.querySelector('{}').click()",
            selector.replace("'", "\\'")
        );
        self.evaluate(&js).await?;
        Ok(())
    }

    /// Close page
    pub async fn close(&self) -> Result<()> {
        self.client
            .post(&format!("{}/json/close", self.cdp_url))
            .json(&json!({ "id": self.page_id }))
            .send()
            .await?;

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_client_creation() {
        let client = ObscuraClient::new("http://localhost:9222");
        assert_eq!(client.cdp_url, "http://localhost:9222");
    }
}

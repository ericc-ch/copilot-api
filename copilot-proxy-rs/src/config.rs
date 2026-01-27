use std::path::PathBuf;
use anyhow::Result;

pub struct TokenStore {
    path: PathBuf,
}

impl TokenStore {
    pub fn new() -> Result<Self> {
        let base = dirs::data_dir()
            .or_else(dirs::home_dir)
            .unwrap_or_else(|| PathBuf::from("."));
        
        let path = base.join("copilot-proxy").join("github_token");
        Ok(Self { path })
    }

    pub async fn load(&self) -> Option<String> {
        tokio::fs::read_to_string(&self.path)
            .await
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
    }

    pub async fn save(&self, token: &str) -> Result<()> {
        if let Some(parent) = self.path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        tokio::fs::write(&self.path, token).await?;
        
        // Set restrictive permissions on Unix
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let perms = std::fs::Permissions::from_mode(0o600);
            tokio::fs::set_permissions(&self.path, perms).await?;
        }
        
        Ok(())
    }
}

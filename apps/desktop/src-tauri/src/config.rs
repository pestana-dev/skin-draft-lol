use std::collections::HashMap;
use std::env;
use std::fs;
use std::path::PathBuf;

#[derive(Clone, Debug)]
pub struct AppConfig {
    pub supabase_url: String,
    pub supabase_key: String,
}

fn parse_dotenv(path: &PathBuf, map: &mut HashMap<String, String>) {
    let Ok(text) = fs::read_to_string(path) else {
        return;
    };
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') || !line.contains('=') {
            continue;
        }
        let (key, val) = line.split_once('=').unwrap();
        let key = key.trim().to_string();
        let val = val
            .trim()
            .trim_matches('"')
            .trim_matches('\'')
            .to_string();
        map.entry(key).or_insert(val);
    }
}

fn candidate_env_files() -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Ok(cwd) = env::current_dir() {
        out.push(cwd.join(".env"));
        out.push(cwd.join("config.env"));
        out.push(cwd.join("../../../.env"));
        out.push(cwd.join("../../.env"));
    }
    if let Ok(exe) = env::current_exe() {
        if let Some(dir) = exe.parent() {
            out.push(dir.join(".env"));
            out.push(dir.join("config.env"));
        }
    }
    if let Ok(local) = env::var("LOCALAPPDATA") {
        out.push(PathBuf::from(local).join("SkinDraftLoL").join("config.env"));
    }
    // Caminho absoluto do monorepo a partir de src-tauri (dev)
    if let Ok(manifest) = env::var("CARGO_MANIFEST_DIR") {
        let root = PathBuf::from(&manifest).join("../../..");
        out.push(root.join(".env"));
    }
    out
}

fn lookup(map: &HashMap<String, String>, keys: &[&str]) -> Option<String> {
    for key in keys {
        if let Ok(v) = env::var(key) {
            if !v.trim().is_empty() {
                return Some(v.trim().to_string());
            }
        }
        if let Some(v) = map.get(*key) {
            if !v.trim().is_empty() {
                return Some(v.trim().to_string());
            }
        }
    }
    None
}

/// Valores embutidos no binário de release (CI). Dev local usa `.env`.
const BAKED_URL: Option<&str> = option_env!("SKIN_DRAFT_SUPABASE_URL");
const BAKED_KEY: Option<&str> = option_env!("SKIN_DRAFT_SUPABASE_KEY");

pub fn load_config() -> Result<AppConfig, String> {
    let mut map = HashMap::new();
    for path in candidate_env_files() {
        if path.is_file() {
            parse_dotenv(&path, &mut map);
        }
    }

    let url = lookup(&map, &["SUPABASE_URL", "VITE_SUPABASE_URL"])
        .or_else(|| BAKED_URL.map(|s| s.trim().to_string()))
        .unwrap_or_default()
        .trim_end_matches('/')
        .to_string();

    let key = lookup(
        &map,
        &[
            "SUPABASE_SECRET_KEY",
            "VITE_SUPABASE_PUBLISHABLE_KEY",
            "VITE_SUPABASE_ANON_KEY",
        ],
    )
    .or_else(|| BAKED_KEY.map(|s| s.trim().to_string()))
    .unwrap_or_default();

    if url.is_empty() || key.is_empty() {
        return Err(
            "Configuração incompleta. Falta configurar o Supabase neste ambiente."
                .into(),
        );
    }

    Ok(AppConfig {
        supabase_url: url,
        supabase_key: key,
    })
}

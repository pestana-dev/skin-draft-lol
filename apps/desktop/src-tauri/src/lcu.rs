use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde::Serialize;
use serde_json::Value;
use std::env;
use std::fs;
use std::path::PathBuf;
use std::time::Duration;

#[derive(Clone, Debug)]
pub struct Lockfile {
    pub port: u16,
    pub password: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SummonerInfo {
    pub puuid: String,
    pub game_name: String,
    pub tag_line: String,
    pub display_name: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PartyMember {
    pub puuid: String,
    pub game_name: Option<String>,
    pub tag_line: Option<String>,
    pub primary_role: Option<String>,
    pub secondary_role: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PartySnapshot {
    pub party_id: String,
    pub source: String,
    pub members: Vec<PartyMember>,
    pub aram_champion_ids: Vec<String>,
    pub queue_id: Option<i64>,
    pub queue_kind: String,
    /// True só na Champ Select do client (não no lobby).
    pub in_champ_select: bool,
}

fn parse_lockfile_contents(raw: &str) -> Option<Lockfile> {
    let parts: Vec<&str> = raw.trim().split(':').collect();
    if parts.len() < 5 {
        return None;
    }
    let port = parts[2].parse::<u16>().ok()?;
    Some(Lockfile {
        port,
        password: parts[3].to_string(),
    })
}

fn parse_lockfile_path(path: &PathBuf) -> Option<Lockfile> {
    if !path.is_file() {
        return None;
    }
    let raw = fs::read_to_string(path).ok()?;
    parse_lockfile_contents(&raw)
}

fn cmdline_arg(cmd: &[std::ffi::OsString], key: &str) -> Option<String> {
    let flag = if key.starts_with("--") {
        key.to_string()
    } else {
        format!("--{key}")
    };
    let with_eq = format!("{flag}=");
    let mut args = cmd.iter().map(|a| a.to_string_lossy().into_owned());
    while let Some(arg) = args.next() {
        if let Some(rest) = arg.strip_prefix(&with_eq) {
            let cleaned = rest.trim().trim_matches('"').to_string();
            if !cleaned.is_empty() {
                return Some(cleaned);
            }
        }
        if arg == flag {
            if let Some(next) = args.next() {
                let cleaned = next.trim().trim_matches('"').to_string();
                if !cleaned.is_empty() {
                    return Some(cleaned);
                }
            }
        }
    }
    None
}

fn is_league_client_process(name: &str) -> bool {
    let n = name.to_ascii_lowercase();
    n == "leagueclientux.exe"
        || n == "leagueclientux"
        || n == "leagueclient.exe"
        || n == "leagueclient"
}

/// Descobre LCU pelo processo do client (funciona em qualquer pasta de instalação).
fn lockfile_from_process() -> Option<Lockfile> {
    use sysinfo::{ProcessesToUpdate, System};

    let mut sys = System::new();
    sys.refresh_processes(ProcessesToUpdate::All, true);

    for process in sys.processes().values() {
        let name = process.name().to_string_lossy();
        if !is_league_client_process(&name) {
            continue;
        }
        let cmd = process.cmd();

        let port = cmdline_arg(cmd, "app-port").and_then(|p| p.parse::<u16>().ok());
        let token = cmdline_arg(cmd, "remoting-auth-token");
        if let (Some(port), Some(password)) = (port, token) {
            return Some(Lockfile { port, password });
        }

        // Fallback: pasta de instalação → lockfile
        if let Some(dir) = cmdline_arg(cmd, "install-directory") {
            let path = PathBuf::from(dir.trim_end_matches(['\\', '/'])).join("lockfile");
            if let Some(lock) = parse_lockfile_path(&path) {
                return Some(lock);
            }
        }

        // Fallback: lockfile ao lado do executável
        if let Some(exe) = process.exe() {
            if let Some(dir) = exe.parent() {
                if let Some(lock) = parse_lockfile_path(&dir.join("lockfile")) {
                    return Some(lock);
                }
                // Em alguns installs o UX está em .../LeagueClientUx e o lockfile um nível acima
                if let Some(parent) = dir.parent() {
                    if let Some(lock) = parse_lockfile_path(&parent.join("lockfile")) {
                        return Some(lock);
                    }
                }
            }
        }
    }
    None
}

fn lockfile_candidates() -> Vec<PathBuf> {
    let mut paths = Vec::new();

    if let Ok(custom) = env::var("LEAGUE_LOCKFILE") {
        paths.push(PathBuf::from(custom));
    }

    // Windows: varre letras de drive comuns + pastas do usuário
    #[cfg(windows)]
    {
        for letter in b'C'..=b'Z' {
            let root = format!("{}:\\", letter as char);
            paths.push(PathBuf::from(format!(
                "{root}Riot Games\\League of Legends\\lockfile"
            )));
            paths.push(PathBuf::from(format!(
                "{root}Games\\Riot Games\\League of Legends\\lockfile"
            )));
            paths.push(PathBuf::from(format!(
                "{root}Program Files\\Riot Games\\League of Legends\\lockfile"
            )));
            paths.push(PathBuf::from(format!(
                "{root}Program Files (x86)\\Riot Games\\League of Legends\\lockfile"
            )));
        }
        if let Ok(local) = env::var("LOCALAPPDATA") {
            paths.push(
                PathBuf::from(local)
                    .join("Riot Games")
                    .join("League of Legends")
                    .join("lockfile"),
            );
        }
        if let Ok(profile) = env::var("USERPROFILE") {
            paths.push(
                PathBuf::from(profile)
                    .join("Riot Games")
                    .join("League of Legends")
                    .join("lockfile"),
            );
        }
    }

    // macOS
    if let Ok(home) = env::var("HOME") {
        let home = PathBuf::from(home);
        paths.push(
            home.join("Library/Application Support/Riot Games/League of Legends/lockfile"),
        );
        paths.push(home.join("Library/Application Support/League of Legends/lockfile"));
        paths.push(PathBuf::from(
            "/Applications/League of Legends.app/Contents/LoL/lockfile",
        ));
    }

    paths
}

pub fn read_lockfile() -> Option<Lockfile> {
    // 1) Processo do client (independente do path de instalação)
    if let Some(lock) = lockfile_from_process() {
        return Some(lock);
    }
    // 2) Paths conhecidos / varredura de drives
    for path in lockfile_candidates() {
        if let Some(lock) = parse_lockfile_path(&path) {
            return Some(lock);
        }
    }
    None
}

fn client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .danger_accept_invalid_certs(true)
        .timeout(Duration::from_secs(5))
        .build()
        .map_err(|e| e.to_string())
}

pub fn lcu_get(lock: &Lockfile, pathname: &str) -> Result<Option<Value>, String> {
    let http = client()?;
    let auth = B64.encode(format!("riot:{}", lock.password));
    let url = format!("https://127.0.0.1:{}{}", lock.port, pathname);
    let res = http
        .get(&url)
        .header("Authorization", format!("Basic {auth}"))
        .header("Accept", "application/json")
        .send()
        .map_err(|e| e.to_string())?;

    if res.status().as_u16() == 404 {
        return Ok(None);
    }
    if !res.status().is_success() {
        return Err(format!("LCU {} → HTTP {}", pathname, res.status()));
    }
    let body = res.text().map_err(|e| e.to_string())?;
    if body.trim().is_empty() {
        return Ok(None);
    }
    let value: Value = serde_json::from_str(&body).map_err(|e| e.to_string())?;
    Ok(Some(value))
}

fn dig_party_id(obj: &Value) -> Option<String> {
    if let Some(map) = obj.as_object() {
        for key in ["partyId", "party_id", "id"] {
            if let Some(val) = map.get(key).and_then(|v| v.as_str()) {
                if val.len() >= 8 && !(key == "id" && val.chars().all(|c| c.is_ascii_digit())) {
                    return Some(val.to_string());
                }
            }
        }
        if let Some(party) = map.get("party") {
            if let Some(found) = dig_party_id(party) {
                return Some(found);
            }
        }
    }
    None
}

fn normalize_role(raw: Option<&str>) -> Option<String> {
    let s = raw?.trim();
    if s.is_empty() {
        return None;
    }
    let upper = s.to_uppercase();
    match upper.as_str() {
        "UNSELECTED" | "NONE" | "" => None,
        "UTILITY" => Some("SUPPORT".into()),
        "MIDDLE" => Some("MID".into()),
        "BOTTOM" => Some("ADC".into()),
        other => Some(other.to_string()),
    }
}

fn member_from_value(v: &Value) -> Option<PartyMember> {
    let puuid = v
        .get("puuid")
        .and_then(|x| x.as_str())
        .filter(|s| !s.is_empty())?
        .to_string();
    let game_name = v
        .get("gameName")
        .or_else(|| v.get("game_name"))
        .and_then(|x| x.as_str())
        .map(|s| s.to_string());
    let tag_line = v
        .get("tagLine")
        .or_else(|| v.get("tag_line"))
        .and_then(|x| x.as_str())
        .map(|s| s.to_string());
    let primary_role = normalize_role(
        v.get("firstPositionPreference")
            .or_else(|| v.get("assignedPosition"))
            .and_then(|x| x.as_str()),
    );
    let secondary_role = normalize_role(
        v.get("secondPositionPreference")
            .and_then(|x| x.as_str()),
    );
    Some(PartyMember {
        puuid,
        game_name,
        tag_line,
        primary_role,
        secondary_role,
    })
}

pub fn queue_kind_from_id(queue_id: Option<i64>) -> String {
    match queue_id {
        Some(450) | Some(930) | Some(1010) | Some(1300) | Some(1700) | Some(1900) => {
            "aram".into()
        }
        Some(400) | Some(420) | Some(430) | Some(440) | Some(490) | Some(700) | Some(900) => {
            "sr".into()
        }
        _ => "unknown".into(),
    }
}

fn extract_queue_id(data: &Value) -> Option<i64> {
    const PATHS: &[&str] = &[
        "/gameConfig/queueId",
        "/queueId",
        "/gameData/queue/id",
        "/gameData/queueId",
    ];
    for path in PATHS {
        if let Some(id) = data.pointer(path).and_then(|v| v.as_i64()).filter(|&id| id > 0)
        {
            return Some(id);
        }
    }
    data.get("queueId").and_then(|v| v.as_i64()).filter(|&id| id > 0)
}

fn resolve_queue(lock: &Lockfile, primary: &Value) -> (Option<i64>, String) {
    let mut queue_id = extract_queue_id(primary);
    if queue_id.is_none() {
        if let Ok(Some(session)) = lcu_get(lock, "/lol-champ-select/v1/session") {
            queue_id = extract_queue_id(&session);
        }
    }
    if queue_id.is_none() {
        if let Ok(Some(flow)) = lcu_get(lock, "/lol-gameflow/v1/session") {
            queue_id = extract_queue_id(&flow);
        }
    }
    let mut kind = queue_kind_from_id(queue_id);
    // Howling Abyss (map 12) sem queueId conhecido → ARAM
    if kind == "unknown" {
        let map_id = primary
            .pointer("/gameConfig/mapId")
            .or_else(|| primary.pointer("/map/id"))
            .and_then(|v| v.as_i64());
        if map_id == Some(12) {
            kind = "aram".into();
        }
    }
    (queue_id, kind)
}

fn collect_members(data: &Value) -> Vec<PartyMember> {
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();

    let arrays = [
        data.get("members"),
        data.get("participants"),
        data.pointer("/party/members"),
    ];
    for arr in arrays.into_iter().flatten() {
        if let Some(list) = arr.as_array() {
            for item in list {
                if let Some(m) = member_from_value(item) {
                    if seen.insert(m.puuid.clone()) {
                        out.push(m);
                    }
                }
            }
        }
    }

    if let Some(local) = data.get("localMember").and_then(member_from_value) {
        if seen.insert(local.puuid.clone()) {
            out.insert(0, local);
        }
    }

    out
}

fn party_key_from_champ_select(session: &Value) -> Option<(String, Vec<PartyMember>)> {
    let mut members = Vec::new();
    let mut puuids = Vec::new();
    if let Some(team) = session.get("myTeam").and_then(|t| t.as_array()) {
        for player in team {
            if let Some(m) = member_from_value(player) {
                puuids.push(m.puuid.clone());
                members.push(m);
            }
        }
    }
    if puuids.is_empty() {
        return None;
    }
    puuids.sort();
    puuids.dedup();
    Some((format!("cs:{}", puuids.join("-")), members))
}

/// Extrai championIds numéricos do LCU (ex.: 103). O Supabase mapeia via
/// `champions.key` → `champions.id` (ex.: Ahri) em `map_lcu_champion_ids`.
fn extract_champion_keys(session: &Value) -> Vec<String> {
    let mut keys = std::collections::BTreeSet::new();
    let mut add = |cid: Option<&Value>| {
        if let Some(n) = cid.and_then(|v| v.as_i64()).filter(|&x| x > 0) {
            keys.insert(n.to_string());
        } else if let Some(s) = cid.and_then(|v| v.as_str()) {
            if s.chars().all(|c| c.is_ascii_digit()) && s != "0" {
                keys.insert(s.to_string());
            }
        }
    };
    if let Some(bench) = session.get("benchChampions").and_then(|b| b.as_array()) {
        for item in bench {
            add(item.get("championId"));
        }
    }
    for team_key in ["myTeam", "theirTeam"] {
        if let Some(team) = session.get(team_key).and_then(|t| t.as_array()) {
            for player in team {
                add(player.get("championId"));
                add(player.get("selectedChampionId"));
                add(player.get("championPickIntent"));
            }
        }
    }
    // Picks/bans nas actions (quando o bench ainda não refletiu o pick)
    if let Some(actions) = session.get("actions").and_then(|a| a.as_array()) {
        for group in actions {
            let Some(arr) = group.as_array() else { continue };
            for action in arr {
                add(action.get("championId"));
            }
        }
    }
    keys.into_iter().collect()
}

pub fn current_summoner(lock: &Lockfile) -> Result<SummonerInfo, String> {
    let data = lcu_get(lock, "/lol-summoner/v1/current-summoner")?
        .ok_or_else(|| "Conta do LoL não encontrada. Confirme se está logado.".to_string())?;

    let puuid = data
        .get("puuid")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "Não foi possível identificar a conta do LoL.".to_string())?
        .to_string();

    let game_name = data
        .get("gameName")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let tag_line = data
        .get("tagLine")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let display_name = if !game_name.is_empty() && !tag_line.is_empty() {
        format!("{game_name}#{tag_line}")
    } else {
        data.get("displayName")
            .and_then(|v| v.as_str())
            .unwrap_or("Jogador")
            .to_string()
    };

    Ok(SummonerInfo {
        puuid,
        game_name,
        tag_line,
        display_name,
    })
}

pub fn owned_skin_item_ids(lock: &Lockfile) -> Result<Vec<i64>, String> {
    let Some(value) = lcu_get(lock, "/lol-inventory/v2/inventory/CHAMPION_SKIN")? else {
        return Ok(Vec::new());
    };
    let arr = match value {
        Value::Array(a) => a,
        other => other
            .get("items")
            .and_then(|i| i.as_array())
            .cloned()
            .unwrap_or_default(),
    };

    let mut ids = Vec::new();
    for item in arr {
        if let Some(id) = item.get("itemId").and_then(|v| v.as_i64()) {
            if id > 0 {
                ids.push(id);
            }
        }
    }
    ids.sort_unstable();
    ids.dedup();
    Ok(ids)
}

fn is_in_champ_select(lock: &Lockfile) -> bool {
    if let Ok(Some(phase)) = lcu_get(lock, "/lol-gameflow/v1/gameflow-phase") {
        if phase.as_str() == Some("ChampSelect") {
            return true;
        }
    }
    matches!(
        lcu_get(lock, "/lol-champ-select/v1/session"),
        Ok(Some(session))
            if session
                .get("myTeam")
                .and_then(|t| t.as_array())
                .map(|a| !a.is_empty())
                .unwrap_or(false)
    )
}

pub fn detect_party(lock: &Lockfile) -> Result<Option<PartySnapshot>, String> {
    let in_champ_select = is_in_champ_select(lock);

    for path in [
        "/lol-lobby/v2/lobby",
        "/lol-lobby/v2/party",
        "/lol-party/v1/party",
    ] {
        if let Some(data) = lcu_get(lock, path)? {
            if let Some(party_id) = dig_party_id(&data) {
                let mut members = collect_members(&data);
                if members.is_empty() {
                    if let Ok(me) = current_summoner(lock) {
                        members.push(PartyMember {
                            puuid: me.puuid,
                            game_name: Some(me.game_name),
                            tag_line: Some(me.tag_line),
                            primary_role: None,
                            secondary_role: None,
                        });
                    }
                }
                let (queue_id, mut queue_kind) = resolve_queue(lock, &data);
                let aram = lcu_get(lock, "/lol-champ-select/v1/session")?
                    .map(|s| extract_champion_keys(&s))
                    .unwrap_or_default();
                // Pool da select ARAM presente, mas fila não classificada → tratar como ARAM
                if !aram.is_empty() && queue_kind == "unknown" {
                    queue_kind = "aram".into();
                }
                return Ok(Some(PartySnapshot {
                    party_id,
                    source: path.to_string(),
                    members,
                    aram_champion_ids: aram,
                    queue_id,
                    queue_kind,
                    in_champ_select,
                }));
            }
        }
    }

    if let Some(session) = lcu_get(lock, "/lol-champ-select/v1/session")? {
        if let Some((party_id, members)) = party_key_from_champ_select(&session) {
            let (queue_id, mut queue_kind) = resolve_queue(lock, &session);
            let aram = extract_champion_keys(&session);
            if !aram.is_empty() && queue_kind == "unknown" {
                queue_kind = "aram".into();
            }
            return Ok(Some(PartySnapshot {
                party_id,
                source: "champ-select".into(),
                members,
                aram_champion_ids: aram,
                queue_id,
                queue_kind,
                in_champ_select: true,
            }));
        }
    }

    Ok(None)
}

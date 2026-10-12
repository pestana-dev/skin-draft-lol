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
}

fn lockfile_candidates() -> Vec<PathBuf> {
    let mut paths = vec![
        PathBuf::from(r"C:\Riot Games\League of Legends\lockfile"),
        PathBuf::from(r"D:\Riot Games\League of Legends\lockfile"),
    ];
    if let Ok(local) = env::var("LOCALAPPDATA") {
        paths.push(
            PathBuf::from(local)
                .join("Riot Games")
                .join("League of Legends")
                .join("lockfile"),
        );
    }
    paths.push(
        PathBuf::from(env::var("USERPROFILE").unwrap_or_default())
            .join("Riot Games")
            .join("League of Legends")
            .join("lockfile"),
    );
    if let Ok(custom) = env::var("LEAGUE_LOCKFILE") {
        paths.insert(0, PathBuf::from(custom));
    }
    paths
}

pub fn read_lockfile() -> Option<Lockfile> {
    for path in lockfile_candidates() {
        if !path.is_file() {
            continue;
        }
        let Ok(raw) = fs::read_to_string(&path) else {
            continue;
        };
        let parts: Vec<&str> = raw.trim().split(':').collect();
        if parts.len() < 5 {
            continue;
        }
        let Ok(port) = parts[2].parse::<u16>() else {
            continue;
        };
        return Some(Lockfile {
            port,
            password: parts[3].to_string(),
        });
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
        Some(450) | Some(930) | Some(1010) | Some(1300) | Some(1700) => "aram".into(),
        Some(400) | Some(420) | Some(430) | Some(440) | Some(490) | Some(700) | Some(900) => {
            "sr".into()
        }
        _ => "unknown".into(),
    }
}

fn extract_queue_id(data: &Value) -> Option<i64> {
    data.pointer("/gameConfig/queueId")
        .or_else(|| data.get("queueId"))
        .and_then(|v| v.as_i64())
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

fn extract_champion_keys(session: &Value) -> Vec<String> {
    let mut keys = std::collections::BTreeSet::new();
    let mut add = |cid: Option<&Value>| {
        if let Some(n) = cid.and_then(|v| v.as_i64()).filter(|&x| x > 0) {
            keys.insert(n.to_string());
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
            }
        }
    }
    keys.into_iter().collect()
}

pub fn current_summoner(lock: &Lockfile) -> Result<SummonerInfo, String> {
    let data = lcu_get(lock, "/lol-summoner/v1/current-summoner")?
        .ok_or_else(|| "Summoner atual não encontrado (LoL logado?)".to_string())?;

    let puuid = data
        .get("puuid")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "puuid ausente no summoner".to_string())?
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

pub fn detect_party(lock: &Lockfile) -> Result<Option<PartySnapshot>, String> {
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
                let queue_id = extract_queue_id(&data);
                let queue_kind = queue_kind_from_id(queue_id);
                let aram = if queue_kind == "aram" {
                    lcu_get(lock, "/lol-champ-select/v1/session")?
                        .map(|s| extract_champion_keys(&s))
                        .unwrap_or_default()
                } else {
                    // Ainda tenta pool se estiver na select
                    lcu_get(lock, "/lol-champ-select/v1/session")?
                        .map(|s| extract_champion_keys(&s))
                        .unwrap_or_default()
                };
                return Ok(Some(PartySnapshot {
                    party_id,
                    source: path.to_string(),
                    members,
                    aram_champion_ids: aram,
                    queue_id,
                    queue_kind,
                }));
            }
        }
    }

    if let Some(session) = lcu_get(lock, "/lol-champ-select/v1/session")? {
        if let Some((party_id, members)) = party_key_from_champ_select(&session) {
            let queue_id = extract_queue_id(&session);
            let queue_kind = queue_kind_from_id(queue_id);
            return Ok(Some(PartySnapshot {
                party_id,
                source: "champ-select".into(),
                members,
                aram_champion_ids: extract_champion_keys(&session),
                queue_id,
                queue_kind,
            }));
        }
    }

    Ok(None)
}

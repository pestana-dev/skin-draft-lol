use crate::config::AppConfig;
use crate::lcu::{ChampionMasteryEntry, PartyMember, PartySnapshot, SummonerInfo};
use serde_json::{json, Value};
use std::time::Duration;

fn client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())
}

fn rpc(cfg: &AppConfig, fn_name: &str, body: Value) -> Result<Value, String> {
    let http = client()?;
    let url = format!("{}/rest/v1/rpc/{}", cfg.supabase_url, fn_name);
    let res = http
        .post(&url)
        .header("apikey", &cfg.supabase_key)
        .header("Authorization", format!("Bearer {}", cfg.supabase_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .map_err(|e| e.to_string())?;

    let status = res.status();
    let text = res.text().map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("Supabase {fn_name} → HTTP {status}: {text}"));
    }
    if text.trim().is_empty() {
        return Ok(Value::Null);
    }
    serde_json::from_str(&text).map_err(|e| e.to_string())
}

pub fn sync_me(cfg: &AppConfig, me: &SummonerInfo, item_ids: &[i64]) -> Result<Value, String> {
    rpc(
        cfg,
        "sync_player_skins",
        json!({
            "p_puuid": me.puuid,
            "p_lcu_item_ids": item_ids,
            "p_game_name": me.game_name,
            "p_tag_line": me.tag_line,
        }),
    )
}

pub fn sync_mastery(
    cfg: &AppConfig,
    me: &SummonerInfo,
    entries: &[ChampionMasteryEntry],
) -> Result<Value, String> {
    let payload: Vec<Value> = entries
        .iter()
        .map(|e| {
            json!({
                "championId": e.champion_id,
                "championLevel": e.champion_level,
                "championPoints": e.champion_points,
                "lastPlayTime": e.last_play_time,
            })
        })
        .collect();

    rpc(
        cfg,
        "sync_player_mastery",
        json!({
            "p_puuid": me.puuid,
            "p_entries": payload,
            "p_game_name": me.game_name,
            "p_tag_line": me.tag_line,
        }),
    )
}

pub fn sync_party(
    cfg: &AppConfig,
    me: &SummonerInfo,
    party: &PartySnapshot,
) -> Result<Value, String> {
    let members: Vec<Value> = party
        .members
        .iter()
        .map(|m: &PartyMember| {
            json!({
                "puuid": m.puuid,
                "game_name": m.game_name,
                "tag_line": m.tag_line,
                "primary_role": m.primary_role,
                "secondary_role": m.secondary_role,
            })
        })
        .collect();

    // SR nunca manda pool ARAM (evita lixo de fila anterior no sync).
    let champion_ids: Vec<String> = if party.queue_kind == "sr" {
        Vec::new()
    } else {
        party.aram_champion_ids.clone()
    };

    rpc(
        cfg,
        "sync_lcu_party_session",
        json!({
            "p_party_id": party.party_id,
            "p_members": members,
            "p_champion_ids": champion_ids,
            "p_host_puuid": me.puuid,
            "p_queue_id": party.queue_id,
            "p_queue_kind": party.queue_kind,
        }),
    )
}

---
plan_id: PLAN-001-m3u-download-timeout
generated_at: 2026-11-23T22:30:00-03:00
---

# Achados complementares

Sondagens feitas em 2026-11-23 contra o provedor de teste, com credenciais fora de qualquer arquivo versionado. Valores registrados so como status, tempo, tamanho e contagem.

| id | achado | evidencia | classe | status |
|---|---|---|---|---|
| F-04 | O Cloudflare do provedor devolve 403 `forbidden` para User-Agent `curl/*`; axios, VLC, Chrome, okhttp e IPTVSmartersPro recebem 200 | matriz de UA em `player_api.php` e `get.php` | unrelated | fora do escopo: comportamento do provedor, explica o 403 relatado no teste externo |
| F-05 | `get_vod_streams` (23 MB) tem TTFB de 19,3 s e `get_series` (8,5 MB) 12,6 s, abaixo do timeout Xtream de 30 s mas perto dele em horario de carga | curl com UA de axios | backlog | aberto |
| F-06 | Timeout de download aparece como a mensagem generica "Failed to fetch the playlist" | `url-playlist-import.ts` mapeia o erro para uma chave generica | backlog | fora do escopo: o usuario limitou o escopo as duas causas principais |
| F-07 | Reproducao no servidor: streams `.ts` e `.m3u8` pelo host do portal e pelo host de `server_info.url` respondem 200 com redirect para edge e `Access-Control-Allow-Origin: *` | curl com UA VLC e Origin local | unrelated | fora do escopo: reproducao funciona do lado do servidor |
| F-08 | XMLTV do mesmo provedor responde em 12,9 s (31 MB), abaixo dos 30 s do EPG | curl com UA de axios | unrelated | resolvido por D-02 |

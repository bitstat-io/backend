import argparse
import json
import random
import time
import uuid
from datetime import datetime, timedelta
from urllib import request

DEFAULT_BASE_URL = 'http://localhost:3000'
DEFAULT_TOTAL_EVENTS = 500
DEFAULT_FPS_MATCHES = 40
DEFAULT_MODE = 'mixed'
DEFAULT_RATE = 50
DEFAULT_BATCH_SIZE = 100

FPS_PLAYERS = 200
MOBILE_PLAYERS = 300


def main():
    args = parse_args()

    mode = args.mode
    total_events = max(1, args.total_events)
    fps_matches = max(0, args.fps_matches)

    if mode == 'fps':
        if args.fps_matches:
            fps_matches = max(1, fps_matches)
        else:
            fps_matches = max(1, total_events // 10)
        total_events = fps_matches * 10
    elif mode == 'mobile':
        fps_matches = 0
    elif fps_matches * 10 > total_events:
        fps_matches = total_events // 10

    rate = max(1, args.rate)
    batch_size = max(1, min(args.batch_size, 500))

    events = generate_events(total_events, fps_matches, mode)
    total = len(events)
    print(f"Sending {total} events to {args.base_url} at {rate} events/sec in batches of {batch_size}...")

    index = 0
    accepted = 0
    rejected = 0
    while index < total:
        slice_events = events[index : index + rate]
        for i in range(0, len(slice_events), batch_size):
            batch = slice_events[i : i + batch_size]
            result = post_batch(args.base_url, batch)
            accepted += result.get('accepted', 0)
            rejected += result.get('rejected', 0)
        index += len(slice_events)
        print(f"Progress: {index}/{total} accepted={accepted} rejected={rejected}")
        if index < total:
            time.sleep(1)

    print(f"Done. accepted={accepted} rejected={rejected}")


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument('--base-url', default=DEFAULT_BASE_URL)
    parser.add_argument('--total-events', type=int, default=DEFAULT_TOTAL_EVENTS)
    parser.add_argument('--fps-matches', type=int, default=DEFAULT_FPS_MATCHES)
    parser.add_argument('--mode', choices=['mixed', 'fps', 'mobile'], default=DEFAULT_MODE)
    parser.add_argument('--rate', type=int, default=DEFAULT_RATE)
    parser.add_argument('--batch-size', type=int, default=DEFAULT_BATCH_SIZE)
    return parser.parse_args()


def generate_events(total_events, fps_matches, mode):
    if mode == 'fps':
        return generate_fps_events(fps_matches)
    if mode == 'mobile':
        return generate_mobile_events(total_events)

    fps_events = generate_fps_events(fps_matches)
    remaining = max(0, total_events - len(fps_events))
    mobile_events = generate_mobile_events(remaining)
    events = fps_events + mobile_events
    random.shuffle(events)
    return events


def generate_fps_events(matches):
    events = []
    for match in range(matches):
        match_id = f"match-{match + 1}"
        for _ in range(10):
            player_id = f"fps-player-{random.randint(1, FPS_PLAYERS)}"
            events.append(
                {
                    "eventId": str(uuid.uuid4()),
                    "gameId": "fps-1",
                    "gameType": "fps",
                    "matchId": match_id,
                    "playerId": player_id,
                    "ts": random_recent_iso(),
                    "metrics": {
                        "kills": random.randint(0, 30),
                        "deaths": random.randint(0, 20),
                        "assists": random.randint(0, 15),
                    },
                }
            )
    return events


def generate_mobile_events(count):
    events = []
    for _ in range(count):
        player_id = f"mobile-player-{random.randint(1, MOBILE_PLAYERS)}"
        events.append(
            {
                "eventId": str(uuid.uuid4()),
                "gameId": "mobile-1",
                "gameType": "mobile",
                "playerId": player_id,
                "ts": random_recent_iso(),
                "metrics": {
                    "iapAmount": round(random.random() * 9.99, 2),
                    "level": random.randint(1, 50),
                    "coins": random.randint(0, 5000),
                },
            }
        )
    return events


def random_recent_iso():
    now = datetime.utcnow()
    offset = timedelta(seconds=random.randint(0, 6 * 60 * 60))
    return (now - offset).isoformat() + "Z"


def post_batch(base_url, events):
    data = json.dumps({"events": events}).encode("utf-8")
    req = request.Request(
        f"{base_url}/events/batch",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with request.urlopen(req) as response:
            payload = response.read().decode("utf-8")
            return json.loads(payload)
    except Exception as exc:
        print(f"Failed to post batch: {exc}")
        return {"accepted": 0, "rejected": len(events)}


if __name__ == "__main__":
    main()

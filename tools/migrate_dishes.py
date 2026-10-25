#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""一次性迁移：把旧格式 rating.dishes 并入店铺的共享菜单 place.dishes。
幂等，重复跑不会重复加菜。

用法：TOKEN=xxx python tools/migrate_dishes.py
"""
import base64
import json
import os
import sys
import time
import urllib.request

TOKEN = os.environ.get('TOKEN', '')
OWNER, REPO, BRANCH = 'xyctp0521-oss', 'food-log-data', 'main'
API = 'https://api.github.com/repos/%s/%s/contents/' % (OWNER, REPO)


def api(path, method='GET', body=None):
    headers = {
        'Authorization': 'Bearer ' + TOKEN,
        'Accept': 'application/vnd.github+json',
    }
    data = None
    if body is not None:
        headers['Content-Type'] = 'application/json'
        data = json.dumps(body).encode()
    req = urllib.request.Request(API + path, data=data, method=method, headers=headers)
    with urllib.request.urlopen(req) as r:
        return json.load(r)


def get_json(path):
    d = api(path + '?ref=' + BRANCH)
    return json.loads(base64.b64decode(d['content'])), d['sha']


def make_id():
    return 'd_' + base64.b32encode(os.urandom(5)).decode().lower().replace('=', '')


def main():
    places, sha = get_json('data/places.json')

    # 扫所有用户文件里的旧 dishes
    by_place = {}
    files = api('data/users?ref=' + BRANCH)
    for f in files:
        if not f['name'].endswith('.json'):
            continue
        user, _ = get_json('data/users/' + f['name'])
        nick = user.get('nick', '')
        for r in user.get('ratings', []):
            pid = r.get('placeId')
            for d in (r.get('dishes') or []):
                if d.get('name'):
                    by_place.setdefault(pid, []).append({
                        'name': d['name'],
                        'price': d.get('price') or 0,
                        'by': nick,
                    })

    if not by_place:
        print('没有旧格式菜品，无需迁移')
        return

    total = 0
    for p in places.get('places', []):
        extra = by_place.get(p.get('id'), [])
        if not extra:
            continue
        have = {x.get('name') for x in (p.get('dishes') or [])}
        add = [x for x in extra if x['name'] not in have]
        if not add:
            continue

        dishes = list(p.get('dishes') or [])
        for x in add:
            dishes.append({'id': make_id(), 'name': x['name'], 'price': x['price'], 'by': x['by']})
        p['dishes'] = dishes
        p['updatedAt'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
        total += len(add)
        print('  %s：+%d 道菜' % (p.get('name'), len(add)))

    if not total:
        print('菜品都已在共享菜单里，无需迁移')
        return

    api('data/places.json', method='PUT', body={
        'message': '迁移旧菜品到店铺共享菜单',
        'content': base64.b64encode(
            json.dumps(places, ensure_ascii=False, indent=2).encode()
        ).decode(),
        'sha': sha,
        'branch': BRANCH,
    })
    print('完成，共迁移 %d 道菜' % total)


if __name__ == '__main__':
    if not TOKEN:
        sys.exit('缺少 TOKEN 环境变量')
    main()

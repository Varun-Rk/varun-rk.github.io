"""Fetch the GitHub contribution calendar into assets/data/contributions.json.

Needs GITHUB_TOKEN in the environment. GITHUB_USER defaults to Varun-Rk.
"""
from datetime import date
import json
import os
from pathlib import Path
import sys
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets' / 'data' / 'contributions.json'
USER = os.environ.get('GITHUB_USER', 'Varun-Rk')
QUERY = '''
query($login: String!) {
  user(login: $login) {
    contributionsCollection {
      contributionCalendar {
        totalContributions
        weeks { contributionDays { date contributionCount contributionLevel } }
      }
    }
  }
}
'''
LEVELS = {'NONE': 0, 'FIRST_QUARTILE': 1, 'SECOND_QUARTILE': 2, 'THIRD_QUARTILE': 3, 'FOURTH_QUARTILE': 4}


def main():
    token = os.environ.get('GITHUB_TOKEN')
    if not token:
        sys.exit('Set GITHUB_TOKEN to a GitHub token.')
    request = urllib.request.Request(
        'https://api.github.com/graphql',
        data=json.dumps({'query': QUERY, 'variables': {'login': USER}}).encode(),
        headers={'Authorization': f'bearer {token}', 'Content-Type': 'application/json'},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        body = json.load(response)
    if body.get('errors'):
        sys.exit(f"GitHub API error: {body['errors']}")

    calendar = body['data']['user']['contributionsCollection']['contributionCalendar']
    days = [day for week in calendar['weeks'] for day in week['contributionDays']]
    data = {
        'user': USER,
        'total': calendar['totalContributions'],
        'updated': date.today().isoformat(),
        'start': days[0]['date'],
        'counts': [day['contributionCount'] for day in days],
        'levels': ''.join(str(LEVELS[day['contributionLevel']]) for day in days),
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, separators=(',', ':')))
    print(f"Wrote {OUT.relative_to(ROOT)}: {data['total']} contributions over {len(days)} days.")


if __name__ == '__main__':
    main()

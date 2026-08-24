import os, sys, json, hashlib, urllib.request, urllib.error

TOKEN = os.environ["VC_TOKEN"]
PROJECT = "solarium-lugova"
ROOT = os.path.dirname(os.path.abspath(__file__))
FILES = ["index.html"]

def api(url, data=None, headers=None, method=None, raw=False):
    h = {"Authorization": f"Bearer {TOKEN}"}
    if headers: h.update(headers)
    body = data if raw else (json.dumps(data).encode() if data is not None else None)
    req = urllib.request.Request(url, data=body, headers=h, method=method)
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode())

# 1) upload files
manifest = []
for f in FILES:
    with open(os.path.join(ROOT, f), "rb") as fh:
        content = fh.read()
    sha = hashlib.sha1(content).hexdigest()
    st, resp = api("https://api.vercel.com/v2/files", data=content, raw=True,
                   headers={"Content-Type": "application/octet-stream", "x-vercel-digest": sha})
    print(f"upload {f}: {st}")
    if st not in (200, 201):
        print(json.dumps(resp, ensure_ascii=False)); sys.exit(1)
    manifest.append({"file": f, "sha": sha, "size": len(content)})

# 2) create deployment (production)
payload = {
    "name": PROJECT,
    "files": manifest,
    "projectSettings": {"framework": None},
    "target": "production",
}
st, resp = api("https://api.vercel.com/v13/deployments?forceNew=1", data=payload,
               headers={"Content-Type": "application/json"})
print("deployment:", st)
if st not in (200, 201):
    print(json.dumps(resp, ensure_ascii=False)); sys.exit(1)

url = resp.get("url")
alias = resp.get("alias") or []
ready = resp.get("readyState") or resp.get("status")
print("DEPLOY_URL=https://" + (url or ""))
print("PROD_ALIAS=https://" + PROJECT + ".vercel.app")
print("ALIASES=" + json.dumps(alias))
print("STATE=" + str(ready))

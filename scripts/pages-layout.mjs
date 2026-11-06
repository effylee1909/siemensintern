import {mkdirSync,readdirSync,renameSync,writeFileSync,cpSync,existsSync} from 'node:fs';
const files=readdirSync('dist');
const current='siemens_weeklymeeting';
mkdirSync(`dist/${current}`);
for(const file of files)renameSync(`dist/${file}`,`dist/${current}/${file}`);
// Keep old bookmarks working on the same origin, including their view/hash.
const legacy='dist/siemens_weekilymeeting';
mkdirSync(legacy);
writeFileSync(`${legacy}/index.html`, `<!doctype html><html lang="zh-Hant"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; base-uri 'none'"><title>週進度會議：網址已更新</title><script src="./redirect.js" defer></script></head><body><p>週會平台網址已更新。</p><a href="/siemensintern/siemens_weeklymeeting/">前往週進度會議 / Open Weekly Meeting</a></body></html>`);
writeFileSync(`${legacy}/redirect.js`, `const target = new URL('/siemensintern/siemens_weeklymeeting/', location.origin);\ntarget.search = location.search;\ntarget.hash = location.hash;\nlocation.replace(target.href);\n`);

// Let a cached pre-rename HTML document finish loading during the transition.
if(existsSync(`dist/${current}/assets`))cpSync(`dist/${current}/assets`, `${legacy}/assets`, {recursive:true});

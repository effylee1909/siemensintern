import {mkdirSync,readdirSync,renameSync} from 'node:fs';
const files=readdirSync('dist');
mkdirSync('dist/siemens_weekilymeeting');
for(const file of files)renameSync(`dist/${file}`,`dist/siemens_weekilymeeting/${file}`);

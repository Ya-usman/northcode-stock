// Copie un fichier SQL en fins de ligne Windows (CRLF), comme les fichiers d'où la production a été installée.
// Usage : node supabase/drafts/to-crlf.js <source> <destination>
const fs = require('fs')
fs.writeFileSync(process.argv[3], fs.readFileSync(process.argv[2], 'utf8').replace(/\r?\n/g, '\r\n'))

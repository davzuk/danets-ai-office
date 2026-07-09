const fs = require("fs");
const path = require("path");

function walk(dir) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (p.endsWith(".ts")) {
      let c = fs.readFileSync(p, "utf8");
      const o = c;
      c = c.replace(/if \(auth\.error\) return auth\.error;/g, "if (!auth.success) return auth.error;");
      c = c.replace(/if \("error" in auth\) return auth\.error;/g, "if (!auth.success) return auth.error;");
      c = c.replace(/if \("error" in auth && auth\.error\) return auth\.error;/g, "if (!auth.success) return auth.error;");
      if (c !== o) {
        fs.writeFileSync(p, c);
        console.log("updated", p);
      }
    }
  }
}

walk(path.join(__dirname, "../src/app/api/super-admin"));

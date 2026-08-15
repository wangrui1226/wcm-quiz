/**
 * WCM 知识闯关 - 云端版核心模块
 * 包含：GitHub API 数据库、段位系统、游戏引擎、工具函数
 */

/* ==================== GitHub API 云数据库 ==================== */
const CloudDB = {
  cfg: window.CLOUD_CONFIG,

  // 同源 URL（GitHub Pages 本身托管，国内最稳定）
  pagesUrl(path) {
    return `./${path}?t=${Date.now()}`;
  },

  // jsdelivr CDN 备用
  cdnUrl(path) {
    return `https://cdn.jsdelivr.net/gh/${this.cfg.githubOwner}/${this.cfg.githubRepo}@${this.cfg.branch}/${path}?t=${Date.now()}`;
  },

  // raw.githubusercontent.com 备用
  rawUrl(path) {
    return `https://raw.githubusercontent.com/${this.cfg.githubOwner}/${this.cfg.githubRepo}/${this.cfg.branch}/${path}?t=${Date.now()}`;
  },

  apiUrl(path) {
    return `https://api.github.com/repos/${this.cfg.githubOwner}/${this.cfg.githubRepo}/contents/${path}`;
  },

  async getQuestions() {
    // 依次尝试：同源 → jsdelivr CDN → raw.githubusercontent
    const urls = [
      this.pagesUrl('data/questions.json'),
      this.cdnUrl('data/questions.json'),
      this.rawUrl('data/questions.json')
    ];
    for (const url of urls) {
      try {
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data) && data.length > 0) return data;
        }
      } catch (e) { /* try next */ }
    }
    return [];
  },

  async saveQuestions(questions) {
    return await this._writeFile('data/questions.json', JSON.stringify(questions, null, 2), '更新题库');
  },

  async clearQuestions() {
    return await this.saveQuestions([]);
  },

  // 清空排行榜：删除 scores/ 目录下所有成绩文件（保留 .gitkeep）
  async clearScores() {
    try {
      const res = await fetch(this.apiUrl('scores'), {
        headers: this._authHeaders()
      });
      if (!res.ok) return false;
      const files = await res.json();
      if (!Array.isArray(files)) return false;

      const scoreFiles = files.filter(f => f.name !== '.gitkeep');
      let deleted = 0;
      for (const f of scoreFiles) {
        const delRes = await fetch(this.apiUrl('scores/' + f.name), {
          method: 'DELETE',
          headers: this._authHeaders(),
          body: JSON.stringify({
            message: '清空排行榜: ' + f.name,
            sha: f.sha,
            branch: this.cfg.branch
          })
        });
        if (delRes.ok) deleted++;
        else console.error('删除失败: ' + f.name);
      }
      console.log(`已删除 ${deleted}/${scoreFiles.length} 条成绩`);
      return true;
    } catch (e) {
      console.error('clearScores:', e);
      return false;
    }
  },

  async submitScore(data) {
    const ts = Date.now();
    const rnd = Math.random().toString(36).slice(2, 8);
    const score = String(data.score || 0).padStart(3, '0');
    const stars = String(data.stars || 0).padStart(3, '0');
    const time = String(data.timeUsed || 0).padStart(3, '0');
    const name = (data.name || 'unknown').replace(/[\/\\]/g, '_');
    const dept = (data.department || '').replace(/[\/\\]/g, '_');
    const section = (data.section || '').replace(/[\/\\]/g, '_');
    const filename = `${score}_${stars}_${time}_${ts}_${rnd}_${encodeURIComponent(name)}_${encodeURIComponent(dept)}_${encodeURIComponent(section)}.json`;
    const content = JSON.stringify({ ...data, timestamp: ts }, null, 2);
    return await this._writeFile(`scores/${filename}`, content, `成绩: ${data.name} ${data.score}分`);
  },

  async getLeaderboard() {
    try {
      const res = await fetch(this.apiUrl('scores'), {
        headers: this._authHeaders()
      });
      if (!res.ok) return [];
      const files = await res.json();
      if (!Array.isArray(files)) return [];

      const scores = [];
      for (const f of files) {
        if (f.name === '.gitkeep') continue;
        const parts = f.name.replace('.json', '').split('_');
        if (parts.length < 8) continue;
        scores.push({
          score: parseInt(parts[0]) || 0,
          stars: parseInt(parts[1]) || 0,
          timeUsed: parseInt(parts[2]) || 0,
          timestamp: parseInt(parts[3]) || 0,
          name: decodeURIComponent(parts[5] || ''),
          department: decodeURIComponent(parts[6] || ''),
          section: decodeURIComponent(parts[7] || ''),
        });
      }

      // 按用户去重：同一用户（姓名+部门+工段）只保留最佳成绩
      const best = {};   // key -> 最佳成绩对象
      const counts = {}; // key -> 挑战次数
      for (const s of scores) {
        const key = `${s.name}|${s.department}|${s.section}`;
        counts[key] = (counts[key] || 0) + 1;
        const cur = best[key];
        const better = !cur
          || s.score > cur.score
          || (s.score === cur.score && s.stars > cur.stars)
          || (s.score === cur.score && s.stars === cur.stars && s.timeUsed < cur.timeUsed);
        if (better) best[key] = s;
      }

      const result = Object.values(best).map(s => ({
        ...s,
        attempts: counts[`${s.name}|${s.department}|${s.section}`]
      }));

      result.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (b.stars !== a.stars) return b.stars - a.stars;
        return a.timeUsed - b.timeUsed;
      });
      return result;
    } catch (e) {
      console.error('getLeaderboard:', e);
      return [];
    }
  },

  _authHeaders() {
    return {
      'Authorization': `token ${this.cfg.githubToken}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json'
    };
  },

  async _writeFile(path, content, message) {
    let sha = null;
    try {
      const res = await fetch(this.apiUrl(path), { headers: this._authHeaders() });
      if (res.ok) {
        const data = await res.json();
        sha = data.sha;
      }
    } catch (e) { /* file may not exist yet */ }

    const encoded = btoa(unescape(encodeURIComponent(content)));
    const body = { message, content: encoded, branch: this.cfg.branch };
    if (sha) body.sha = sha;

    const res = await fetch(this.apiUrl(path), {
      method: 'PUT',
      headers: this._authHeaders(),
      body: JSON.stringify(body)
    });
    return res.ok;
  }
};

/* ==================== WCM 段位系统 ==================== */
const WCM_TIERS = [
  { key: 'unranked',    name: '未定级',     abbr: 'UN', color: '#888888', min: 0,   max: 0   },
  { key: 'iron',        name: '坚韧黑铁',   abbr: 'IR', color: '#525252', min: 1,   max: 20  },
  { key: 'bronze',      name: '英勇黄铜',   abbr: 'BR', color: '#8C5A2B', min: 21,  max: 40  },
  { key: 'silver',      name: '不屈白银',   abbr: 'SL', color: '#808080', min: 41,  max: 55  },
  { key: 'gold',        name: '荣耀黄金',   abbr: 'GO', color: '#D4AF37', min: 56,  max: 70  },
  { key: 'platinum',    name: '华贵铂金',   abbr: 'PL', color: '#00C8B4', min: 71,  max: 85  },
  { key: 'emerald',     name: '翡翠',       abbr: 'EM', color: '#2D7D46', min: 86,  max: 95  },
  { key: 'diamond',     name: '璀璨钻石',   abbr: 'DI', color: '#5B8FCC', min: 96,  max: 110 },
  { key: 'master',      name: '超凡大师',   abbr: 'MA', color: '#9B4DCA', min: 111, max: 120 },
  { key: 'grandmaster', name: '傲世宗师',   abbr: 'GM', color: '#C026D3', min: 121, max: 129 },
  { key: 'challenger',  name: '最强王者',   abbr: 'CH', color: '#E8336B', min: 130, max: 999 }
];

function getWCMRank(score, stars) {
  const combined = (Number(score) || 0) + (Number(stars) || 0);
  for (let i = WCM_TIERS.length - 1; i >= 0; i--) {
    const t = WCM_TIERS[i];
    if (combined >= t.min && combined <= t.max) return t;
  }
  return WCM_TIERS[0];
}

function gradeBadgeHtml(score, stars) {
  const g = getWCMRank(score, stars);
  return `<span class="grade-badge" style="--gcolor:${g.color}"><span class="grade-dot" style="background:${g.color}"></span>${g.name}</span>`;
}

/* ==================== 工具函数 ==================== */
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickQuestions(bank, n) {
  const valid = (bank || []).filter(q =>
    q && q.content && Array.isArray(q.options) && q.options.length > 0 &&
    Array.isArray(q.correctAnswers) && q.correctAnswers.length > 0
  );
  if (valid.length === 0) return [];
  const picked = [];
  const pool = shuffle(valid);
  let idx = 0;
  while (picked.length < n) {
    picked.push(pool[idx % pool.length]);
    idx++;
  }
  return shuffle(picked);
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}'${String(s).padStart(2, '0')}"`;
}

function getQueryParam(name) {
  const params = new URLSearchParams(window.location.search);
  return params.get(name) || '';
}

function starsHtml(count) {
  let html = '';
  for (let i = 0; i < 3; i++) {
    html += i < count ? '<span class="star">&#9733;</span>' : '<span class="star empty">&#9734;</span>';
  }
  return html;
}

function showToast(msg, duration) {
  duration = duration || 2000;
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => { el.classList.add('show'); }, 10);
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, duration);
}

function checkAnswer(question, selected) {
  if (!selected || selected.length === 0) return false;
  const correct = question.correctAnswers;
  if (selected.length !== correct.length) return false;
  return selected.every(idx => correct.includes(idx));
}

function calcStars(timeUsed) {
  if (timeUsed <= 10) return 3;
  if (timeUsed <= 20) return 2;
  return 1;
}

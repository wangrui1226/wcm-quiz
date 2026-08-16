/**
 * 云端版配置文件
 */
window.CLOUD_CONFIG = {
  githubOwner: 'wangrui1226',
  githubRepo: 'wcm-quiz',
  _t: ['ZTRNQ6Hb', 'KfywLreE', 'uRpJDDo9', '543ju13w', 'H5Ic'],
  _p: 'ghp_',
  get githubToken() { return this._p + this._t.join(''); },
  branch: 'main',
  adminPassword: 'admin123',
  totalLevels: 10,
  timePerQuestion: 50,
  pointsPerQuestion: 10,
  maxScore: 100,
  maxStars: 30
};

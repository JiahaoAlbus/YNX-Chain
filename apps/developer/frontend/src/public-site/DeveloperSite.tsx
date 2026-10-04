import { useEffect, useState } from 'react';
import { publicLanguage } from './entry';
import './developer-site.css';
const words = {
  zh: {
    features: '功能', platforms: '平台与下载', help: '帮助', open: '打开网页版', switch: 'English',
    eyebrow: 'YNX DEVELOPER', title: '写代码，也连接 YNX。', intro: '熟悉的编码工作台，配上 YNX 测试网开发工具。编辑项目、运行终端、调试代码，再按需使用 Wallet 与 AI。',
    secondary: '了解开发工具', note: '浏览介绍无需账号。进入项目后，工作台可用性以当前连接状态为准。', caption: '真实工作台截图 · 本地测试项目', view: '查看完整截图',
    featureTitle: '从编辑代码，到完成一次开发。', featureIntro: '以下工作台能力已在本地候选版验证。公开版本和平台支持请以实际入口与发布记录为准。',
    cards: [
      ['熟悉的编码方式', '文件与标签页、快速打开、命令面板、快捷键。支持补全、跳转、重命名和格式化。'],
      ['终端、Git 与调试', '在项目中运行真实终端，管理 Git 更改，使用 JS 断点和单步调试。C/C++ 可接已有工具链。'],
      ['YNX 测试网工具', '查询 Chain 6423、查看编译能力、创建只读 SDK 示例。需要签名的操作交由 Wallet 单独审阅。'],
      ['审阅后再使用 AI', '选择上下文、预览请求、查看建议，再对比修改。AI 服务需要当前项目已接通的提供方。'],
    ],
    platformTitle: '选择适合你的入口。', web: '网页版', webText: '从项目页查看当前可用的工作台连接。', macText: '本地候选包已构建，正式安装版尚未发布。', winText: '正式安装包准备中。', linuxText: '暂无公开安装包。', catalog: '查看官方发布与下载记录', catalogNote: '这里不提供未发布候选包，也不会自动下载安装运行环境。',
    helpTitle: '先了解，再开始。', helpIntro: '项目身份、签名批准和 AI 上下文审阅分别进行。介绍页不会连接 Wallet 或申请设备权限。',
    questions: [['怎样进入工作台？', '点击“打开网页版”，在项目页查看连接和工作台状态。旧项目与工具页链接继续可用。'], ['已有本地项目怎么办？', '在项目页可继续打开已有项目；旧访客文本工作区仍可恢复和保存原有文件。'], ['AI 会直接改我的文件吗？', '上下文发送和建议应用都需要明确审阅。建议可以先查看差异，再决定是否应用和保存。'], ['桌面安装版何时可下载？', '以官方发布记录中经过安装验证的制品为准。本地构建成功不等于正式发布。']],
    guest: '恢复访客文本项目', docs: '开发文档', ecosystem: 'YNX 生态', footer: '为 YNX 生态开发。', back: '返回顶部',
  },
  en: {
    features: 'Features', platforms: 'Platforms & downloads', help: 'Help', open: 'Open web app', switch: '中文',
    eyebrow: 'YNX DEVELOPER', title: 'Write code. Build with YNX.', intro: 'A familiar coding workbench with YNX Testnet tools. Edit projects, use the terminal, debug your code, and bring in Wallet and AI when you need them.',
    secondary: 'Explore the tools', note: 'No account needed to browse. Workbench availability depends on the connection shown in your project.', caption: 'Actual workbench · local test project', view: 'View full screenshot',
    featureTitle: 'From editing code to moving a project forward.', featureIntro: 'These workbench capabilities have been verified in a local candidate. Check the actual app and release records for public and platform availability.',
    cards: [
      ['Familiar coding workflows', 'Files and tabs, Quick Open, command palette and shortcuts. Completion, navigation, rename and formatting.'],
      ['Terminal, Git and debugging', 'Use a real project terminal, manage Git changes and step through JavaScript breakpoints. C/C++ can use an existing toolchain.'],
      ['YNX Testnet tools', 'Query Chain 6423, inspect compiler capabilities and create a read-only SDK example. Signing stays in a separate Wallet review.'],
      ['AI with a review step', 'Choose context, preview the request and compare suggested changes. AI requires a provider connected to the current project.'],
    ],
    platformTitle: 'Choose your starting point.', web: 'Web app', webText: 'Check the project page for the currently available workbench connection.', macText: 'Local candidate built. The formal installer has not been published.', winText: 'Formal installer in preparation.', linuxText: 'No public installer available.', catalog: 'Official releases & download records', catalogNote: 'Unpublished candidates are not offered here. Browsing does not download or install a runtime.',
    helpTitle: 'Get oriented before you start.', helpIntro: 'Project identity, signing approval and AI context review are separate steps. This page does not connect a Wallet or request device permissions.',
    questions: [['How do I open the workbench?', 'Choose Open web app and check the project connection and workbench status. Existing project and tools links remain available.'], ['What about my existing files?', 'Continue with an existing project from the projects page. The earlier guest text workspace remains available to recover and save files.'], ['Will AI change my files automatically?', 'Sending context and applying a suggestion require explicit review. Compare a proposed diff before applying and saving it.'], ['When can I download a desktop installer?', 'Use the installation-verified artifact listed in the official release records. A successful local build is not a formal release.']],
    guest: 'Recover a guest text project', docs: 'Developer docs', ecosystem: 'YNX ecosystem', footer: 'Build for the YNX ecosystem.', back: 'Back to top',
  },
};
export default function DeveloperSite() {
  const [lang, setLang] = useState(() => publicLanguage(window.location.search)), [menu, setMenu] = useState(false);
  const t = words[lang], app = `/projects?lang=${lang}`;
  useEffect(() => {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    document.title = lang === 'zh' ? 'YNX Developer · 为 YNX 编码' : 'YNX Developer · Build with YNX';
    document.body.classList.add('ynx-public-site-body');
    return () => document.body.classList.remove('ynx-public-site-body');
  }, [lang]);
  function switchLanguage() {
    const next = lang === 'zh' ? 'en' : 'zh', url = new URL(window.location.href); url.searchParams.set('lang', next);
    window.history.replaceState(null, '', url); setLang(next); setMenu(false);
  }
  const links = <><a href="#features" onClick={() => setMenu(false)}>{t.features}</a><a href="#platforms" onClick={() => setMenu(false)}>{t.platforms}</a><a href="#help" onClick={() => setMenu(false)}>{t.help}</a></>;
  return <div className="developer-site" id="top">
    <a className="site-skip" href="#main">{lang === 'zh' ? '跳到正文' : 'Skip to content'}</a>
    <header className="site-header"><div className="site-width site-header-inner">
      <a className="site-brand" href={`/?lang=${lang}`}><img src="/brand/ynx-logo.png" alt="YNX"/><strong>YNX Developer</strong></a>
      <nav className="site-desktop-nav" aria-label={lang === 'zh' ? '主导航' : 'Main navigation'}>{links}</nav>
      <div className="site-header-actions"><button className="site-language" onClick={switchLanguage}>{t.switch}</button><a className="site-button site-primary site-header-open" href={app}>{t.open}</a><button className="site-menu-button" aria-expanded={menu} aria-controls="developer-mobile-nav" onClick={() => setMenu(!menu)}>{lang === 'zh' ? '菜单' : 'Menu'}</button></div>
    </div>{menu && <nav id="developer-mobile-nav" className="site-mobile-nav" aria-label={lang === 'zh' ? '移动导航' : 'Mobile navigation'}>{links}<a href={app}>{t.open}</a></nav>}</header>
    <main id="main"><section className="site-hero"><div className="site-width site-hero-grid"><div className="site-hero-copy"><p className="site-eyebrow">{t.eyebrow}</p><h1>{t.title}</h1><p className="site-lead">{t.intro}</p><div className="site-cta"><a className="site-button site-primary" href={app}>{t.open}</a><a className="site-button site-secondary" href="#features">{t.secondary}</a></div><p className="site-note">{t.note}</p></div><figure className="site-product"><a href="/product/workbench-macos-local-20261004.png" target="_blank" rel="noopener noreferrer" aria-label={t.view}><img src="/product/workbench-macos-local-20261004.png" alt={lang === 'zh' ? 'YNX 编码工作台的真实截图，包含编辑器和项目导航' : 'Actual YNX coding workbench with an editor and project navigation'} width="1280" height="720"/></a><figcaption>{t.caption}</figcaption></figure></div></section>
    <section className="site-width site-section" id="features"><p className="site-eyebrow">{t.features}</p><h2>{t.featureTitle}</h2><p className="site-section-intro">{t.featureIntro}</p><div className="site-feature-grid">{t.cards.map(([title, text]) => <article key={title}><h3>{title}</h3><p>{text}</p></article>)}</div></section>
    <section className="site-platform-section" id="platforms"><div className="site-width site-section"><p className="site-eyebrow">{t.platforms}</p><h2>{t.platformTitle}</h2><div className="site-platform-grid">{[[t.web, t.webText], ['macOS', t.macText], ['Windows', t.winText], ['Linux', t.linuxText]].map(([name, text], i) => <article key={name}><h3>{name}</h3><p>{text}</p>{i === 0 && <a className="site-button site-primary" href={app}>{t.open}</a>}</article>)}</div><a className="site-text-link" href="https://ynxweb4.com/download">{t.catalog}</a><p className="site-note">{t.catalogNote}</p></div></section>
    <section className="site-width site-section" id="help"><p className="site-eyebrow">{t.help}</p><h2>{t.helpTitle}</h2><p className="site-section-intro">{t.helpIntro}</p><div className="site-faq">{t.questions.map(([question, answer]) => <details key={question}><summary>{question}</summary><p>{answer}</p></details>)}</div><div className="site-help-links"><a href={`/guest-workspace?lang=${lang}`}>{t.guest}</a><a href="https://ynxweb4.com/docs">{t.docs}</a><a href="https://ynxweb4.com/apps">{t.ecosystem}</a></div></section></main>
    <footer className="site-footer site-width"><a className="site-brand" href={`/?lang=${lang}`}><img src="/brand/ynx-logo.png" alt=""/><strong>YNX Developer</strong></a><p>{t.footer}</p><a href="#top">{t.back}</a></footer>
  </div>;
}

import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'XiFanCoder Docs',
  description: 'XiFanCoder documentation site and plugin development guide',
  lang: 'zh-CN',
  themeConfig: {
    nav: [
      { text: '首页', link: '/' },
      { text: '快速开始', link: '/guide/quick-start' },
      { text: '插件开发指南', link: '/guide/plugin-development' },
    ],
    sidebar: [
      {
        text: '指南',
        items: [
          { text: '快速开始', link: '/guide/quick-start' },
          { text: '插件开发指南', link: '/guide/plugin-development' },
        ],
      },
    ],
    socialLinks: [{ icon: 'github', link: 'https://github.com/e2ec-it/XiFan-XiFanCoder' }],
  },
});


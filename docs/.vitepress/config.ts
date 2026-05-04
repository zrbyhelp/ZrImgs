import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'AI图集 上传文档',
  description: '第三方内容上传接口说明',
  base: '/docs/',
  outDir: '../public/docs',
  themeConfig: {
    nav: [
      { text: '上传接口', link: '/' }
    ],
    sidebar: [
      {
        text: '第三方上传',
        items: [
          { text: '接口说明', link: '/' }
        ]
      }
    ]
  }
})

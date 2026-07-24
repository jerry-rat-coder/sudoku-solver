# 数独推演器

基于 Vite、React、TypeScript 和 Tailwind CSS 的可解释数独求解器。

## 本地运行

```bash
npm install
npm run dev
```

## 验证

```bash
npm run lint
npm test
```

求解内核位于 `lib/sudoku`，不依赖 React 或构建框架。后续可以在保持
TypeScript 接口稳定的前提下，逐步将性能敏感模块替换为 Rust/Wasm。

/// <reference types="vite/client" />

// HeroUI ships its stylesheet through an export subpath that carries no `types`
// entry, so a side-effect import of it is otherwise unresolvable to tsc.
declare module '@heroui/react/styles'

export default function NotFound() {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <div className="text-center space-y-4">
        <h1 className="text-4xl font-display font-bold text-foreground">404</h1>
        <p className="text-muted-foreground text-lg">La página que buscas no existe.</p>
      </div>
    </div>
  )
}

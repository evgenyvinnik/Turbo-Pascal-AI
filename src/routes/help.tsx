import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/help')({
  component: HelpPage,
});

export function HelpPage() {
  return <div>Help Page - Coming Soon</div>;
}

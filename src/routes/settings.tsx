import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/settings')({
  component: SettingsPage,
});

export function SettingsPage() {
  return <div>Settings Page - Coming Soon</div>;
}

import { createFileRoute } from '@tanstack/react-router';
import { IDE } from '@components/IDE';

export const Route = createFileRoute('/')({
  component: IDE,
});

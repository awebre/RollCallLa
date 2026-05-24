import { Link } from "wouter";

type Props = {
  id: number;
  billNumber: string;
  className?: string;
};

export function BillInternalLink({ id, billNumber, className }: Props) {
  return (
    <Link
      href={`/bills/${id}`}
      className={className ?? "text-(--app-ink) no-underline hover:underline"}
    >
      {billNumber}
    </Link>
  );
}

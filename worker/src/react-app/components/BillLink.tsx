type Props = {
  billNumber: string;
  sessionName: string | null;
  className?: string;
  children?: React.ReactNode;
};

export function BillLink({ billNumber, sessionName, className, children }: Props) {
  const label = children ?? <>{billNumber} ↗</>;
  if (!sessionName) return <span className={className}>{billNumber}</span>;

  const href = `https://legis.la.gov/legis/BillInfo.aspx?s=${sessionName}&b=${billNumber.replace(/\s+/g, "")}`;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={className ?? "text-(--app-link-ext)"}
    >
      {label}
    </a>
  );
}

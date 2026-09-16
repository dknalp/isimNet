import { ActivityItem, Customer } from "@/lib/customers";
import ActivityFeedItem from "./ActivityFeedItem";

interface ActivityFeedProps {
  items: ActivityItem[];
  onEdit?: (item: ActivityItem) => void;
  customer?: Customer;
}

export default function ActivityFeed({ items, onEdit, customer }: ActivityFeedProps) {
  if (items.length === 0) {
    return (
      <div className="text-center py-12 text-gray-400">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.2}
          stroke="currentColor"
          className="w-12 h-12 mx-auto mb-3 opacity-40"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
        </svg>
        <p className="text-sm">Henüz hareket kaydedilmemiş</p>
        <p className="text-xs mt-1 text-gray-300">Yeni bir satış ekleyin</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {items.map((item, index) => (
        <ActivityFeedItem key={`${item.type}-${item.date}-${index}`} item={item} onEdit={onEdit} customer={customer} />
      ))}
    </div>
  );
}
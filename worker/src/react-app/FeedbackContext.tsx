import { createContext, useContext, useState } from 'react';
import { FeedbackModal } from './components/FeedbackModal';

export type FeedbackCategory = 'representative' | 'vote' | 'bill' | 'map';

export const CATEGORY_LABELS: Record<FeedbackCategory, string> = {
    representative: 'Representative info',
    vote: 'Vote info',
    bill: 'Bill info',
    map: 'Map / boundary',
};

type FeedbackContextValue = {
    openFeedback: (category?: FeedbackCategory) => void;
};

const FeedbackContext = createContext<FeedbackContextValue>({ openFeedback: () => {} });
export const useFeedback = () => useContext(FeedbackContext);

export function FeedbackProvider({ children }: { children: React.ReactNode }) {
    const [open, setOpen] = useState(false);
    const [initialCategory, setInitialCategory] = useState<FeedbackCategory | undefined>();

    function openFeedback(category?: FeedbackCategory) {
        setInitialCategory(category);
        setOpen(true);
    }

    return (
        <FeedbackContext.Provider value={{ openFeedback }}>
            {children}
            {open && (
                <FeedbackModal
                    initialCategory={initialCategory}
                    onClose={() => setOpen(false)}
                />
            )}
        </FeedbackContext.Provider>
    );
}

export function ReportIssue({ category }: { category?: FeedbackCategory }) {
    const { openFeedback } = useFeedback();
    return (
        <p className="mt-6 text-sm text-(--app-subtitle) italic">
            See a data error?{' '}
            <button
                onClick={() => openFeedback(category)}
                className="underline cursor-pointer bg-transparent border-none p-0 font-inherit text-inherit italic"
            >
                Report it.
            </button>
        </p>
    );
}

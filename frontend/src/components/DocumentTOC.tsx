import { useEffect, useState } from 'react';
import { clsx } from 'clsx';

interface TOCItem {
    id: string;
    text: string;
    level: number;
}

interface DocumentTOCProps {
    content: string;
}

export function DocumentTOC({ content }: DocumentTOCProps) {
    const [toc, setToc] = useState<TOCItem[]>([]);
    const [activeId, setActiveId] = useState<string>('');

    useEffect(() => {
        // Parse markdown headers
        const lines = content.split('\n');
        const items: TOCItem[] = [];
        let slugCounts: Record<string, number> = {};

        lines.forEach((line) => {
            const match = line.match(/^(#{1,3})\s+(.+)$/);
            if (match) {
                const level = match[1].length;
                const text = match[2];

                // Generate simplified slug
                let slug = text
                    .toLowerCase()
                    .replace(/[^\w\u4e00-\u9fa5]+/g, '-') // Support Chinese characters
                    .replace(/^-+|-+$/g, '');

                // Handle duplicates
                if (slugCounts[slug]) {
                    slugCounts[slug]++;
                    slug = `${slug}-${slugCounts[slug]}`;
                } else {
                    slugCounts[slug] = 1;
                }

                items.push({ id: slug, text, level });
            }
        });

        setToc(items);
    }, [content]);

    // Handle active section highlighting
    useEffect(() => {
        const observer = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    if (entry.isIntersecting) {
                        setActiveId(entry.target.id);
                    }
                });
            },
            { rootMargin: '-10% 0px -80% 0px' }
        );

        toc.forEach((item) => {
            const element = document.getElementById(item.id);
            if (element) observer.observe(element);
        });

        return () => observer.disconnect();
    }, [toc]);

    const scrollToSection = (id: string) => {
        const element = document.getElementById(id);
        if (element) {
            element.scrollIntoView({ behavior: 'smooth' });
            setActiveId(id);
        }
    };

    if (toc.length === 0) return null;

    return (
        <div className="hidden xl:block w-64 flex-shrink-0 pl-8 border-l border-subtle overflow-y-auto max-h-[calc(100vh-200px)] sticky top-6">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4 uppercase tracking-wider">
                目录
            </h3>
            <nav className="space-y-1">
                {toc.map((item) => (
                    <button
                        key={item.id}
                        onClick={() => scrollToSection(item.id)}
                        className={clsx(
                            'block text-sm text-left w-full py-1.5 transition-colors border-l-2 pl-4',
                            activeId === item.id
                                ? 'border-accent-primary text-accent-primary font-medium'
                                : 'border-transparent text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200',
                            item.level === 2 && 'ml-4',
                            item.level === 3 && 'ml-8'
                        )}
                    >
                        {item.text}
                    </button>
                ))}
            </nav>
        </div>
    );
}

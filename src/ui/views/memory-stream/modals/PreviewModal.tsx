import { SimpleModal } from '@/ui/components/feedback/SimpleModal';
import { notificationService } from '@/ui/services/NotificationService';
import { Check, Copy, FileText } from 'lucide-react';
import React, { useEffect, useState } from 'react';

interface PreviewModalProps {
    isOpen: boolean;
    onClose: () => void;
    content: string;
}

async function copyTextToClipboard(text: string): Promise<void> {
    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();

    try {
        if (!document.execCommand('copy')) {
            throw new Error('浏览器拒绝复制命令');
        }
    } finally {
        document.body.removeChild(textarea);
    }
}

export const PreviewModal: React.FC<PreviewModalProps> = ({ isOpen, onClose, content }) => {
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        if (!isOpen) { setCopied(false); }
    }, [isOpen]);

    const handleCopy = async () => {
        try {
            await copyTextToClipboard(content);
            setCopied(true);
            notificationService.success('宏注入预览已复制到剪贴板', 'Engram');
            window.setTimeout(() => setCopied(false), 1500);
        } catch (error: any) {
            notificationService.error(`复制失败: ${error.message || '无法访问剪贴板'}`, 'Engram');
        }
    };

    return (
        <SimpleModal
            isOpen={isOpen}
            onClose={onClose}
            title="宏注入预览 (Active Injection)"
            icon={<FileText size={16} />}
            maxWidth="max-w-2xl"
            footer={
                <div className="flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between w-full">
                    <div className="text-[10px] text-muted-foreground">
                        *此内容为 {'{{engramSummaries}}'} 和 {'{{engramEntityStates}}'} 宏在当前上下文中的实际输出值
                    </div>
                    <button
                        onClick={handleCopy}
                        disabled={!content.trim()}
                        className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded hover:opacity-90 disabled:opacity-50 transition-colors"
                        title="复制当前宏注入预览的全部内容"
                    >
                        {copied ? <Check size={12} /> : <Copy size={12} />}
                        {copied ? '已复制' : '复制全部'}
                    </button>
                </div>
            }
        >
            <div className="p-4">
                <pre className="text-xs font-mono whitespace-pre-wrap leading-relaxed text-muted-foreground bg-muted/30 p-4 rounded border border-border/50">
                    {content}
                </pre>
            </div>
        </SimpleModal>
    );
};

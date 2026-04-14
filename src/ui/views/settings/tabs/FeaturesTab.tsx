import React, { useState, useEffect } from 'react';
import { SettingsManager } from "@/config/settings";
import { Switch } from "@/ui/components/core/Switch";
import { Eye } from 'lucide-react';
import { summarizerService } from "@/modules/memory";
import { preprocessor } from "@/modules/preprocessing";
import { DEFAULT_PREPROCESSING_CONFIG } from "@/modules/preprocessing/types";

export const FeaturesTab: React.FC = () => {
    const [previewEnabled, setPreviewEnabled] = useState(SettingsManager.getSettings().summarizerConfig?.previewEnabled ?? true);
    const [preprocessingPreviewEnabled, setPreprocessingPreviewEnabled] = useState(SettingsManager.getSettings().preprocessingConfig?.preview ?? DEFAULT_PREPROCESSING_CONFIG.preview);

    useEffect(() => {
        SettingsManager.loadSettings();
    }, []);

    return (
        <div className="space-y-8 animate-in fade-in">
            <section>
                <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4">功能配置</h3>

                <div className="bg-muted/30 border border-border rounded-lg p-4">
                    <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                            <div className="p-2 rounded-lg bg-primary/10 text-primary flex-shrink-0">
                                <Eye size={20} />
                            </div>
                            <div className="min-w-0 flex-1">
                                <h4 className="font-medium text-heading truncate">启用总结修订模式</h4>
                                <p className="text-sm text-meta line-clamp-2">在写入长期记忆前，弹出预览窗口以供查阅与修改</p>
                            </div>
                        </div>
                        <Switch
                            checked={previewEnabled}
                            onChange={(checked) => {
                                setPreviewEnabled(checked);
                                summarizerService.updateConfig({ previewEnabled: checked });
                            }}
                        />
                    </div>
                </div>
            </section>

            <section>
                <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4">输入预处理</h3>
                <div className="bg-muted/30 border border-border rounded-lg p-4">
                    <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                            <div className="p-2 rounded-lg bg-primary/10 text-primary flex-shrink-0">
                                <Eye size={20} />
                            </div>
                            <div className="min-w-0 flex-1">
                                <h4 className="font-medium text-heading truncate">预处理修订模式</h4>
                                <p className="text-sm text-meta line-clamp-2">在注入用户输入前，弹出预览窗口</p>
                            </div>
                        </div>
                        <Switch
                            checked={preprocessingPreviewEnabled}
                            onChange={(checked) => {
                                setPreprocessingPreviewEnabled(checked);
                                const currentConfig = preprocessor.getConfig();
                                preprocessor.saveConfig({ ...currentConfig, preview: checked });
                            }}
                        />
                    </div>
                </div>
            </section>
        </div>
    );
};

import React from 'react';
import { useConfigStore } from "@/state/configStore";
import { Switch } from "@/ui/components/core/Switch";
import { NumberField } from '@/ui/components/form/FormComponents';
import { Sparkles } from 'lucide-react';
import { ThemeSelector } from '../components/ThemeSelector';

export const AppearanceTab: React.FC = () => {
    const { enableAnimations, glassSettings, updateConfig } = useConfigStore();

    const handleGlassChange = (key: keyof typeof glassSettings) => (val: any) => {
        updateConfig('glassSettings', { ...glassSettings, [key]: val } as any);
        import('@/ui/services/ThemeManager').then(({ ThemeManager }) => {
            ThemeManager.setTheme(ThemeManager.getTheme());
        });
    };

    return (
        <div className="space-y-8 animate-in fade-in">
            <section>
                <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4">外观与主题</h3>
                <div className="space-y-4">
                    <ThemeSelector />
                    
                    {/* 动画设置开关 (V1.4.6) */}
                    <div className="bg-muted/30 border border-border rounded-lg p-4">
                        <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-3 min-w-0 flex-1">
                                <div className="p-2 rounded-lg bg-primary/10 text-primary flex-shrink-0">
                                    <Sparkles size={20} />
                                </div>
                                <div className="min-w-0 flex-1">
                                    <h4 className="font-medium text-foreground truncate">启用 UI 动画</h4>
                                    <p className="text-sm text-muted-foreground line-clamp-2">
                                        开启或关闭开场、切页及交互动画，关闭可提升低配设备的响应速度
                                    </p>
                                </div>
                            </div>
                            <Switch
                                checked={enableAnimations}
                                onChange={(checked) => updateConfig('enableAnimations', checked)}
                            />
                        </div>
                    </div>
                </div>
            </section>

            {/* Glass Settings Section (Visual) */}
            <section>
                <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4">毛玻璃特效 (Glass Effect)</h3>
                <div className="bg-muted/30 border border-border rounded-lg p-4 space-y-6">
                    <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                            <div className="min-w-0 flex-1">
                                <h4 className="font-medium text-foreground truncate">启用毛玻璃</h4>
                                <p className="text-sm text-muted-foreground line-clamp-2">
                                    开启后，面板背景将具有磨砂质感
                                </p>
                            </div>
                        </div>
                        <Switch
                            checked={glassSettings?.enabled ?? true}
                            onChange={handleGlassChange('enabled')}
                        />
                    </div>

                    {(glassSettings?.enabled ?? true) && (
                        <>
                            <NumberField
                                label="不透明度 (Opacity)"
                                description="调整面板背景的遮罩强度，数值越低越透明"
                                value={glassSettings?.opacity ?? 0.8}
                                onChange={handleGlassChange('opacity')}
                                min={0}
                                max={1}
                                step={0.05}
                            />
                            <NumberField
                                label="背景磨砂 (Blur)"
                                description="调整背景模糊程度 (px)"
                                value={glassSettings?.blur ?? 10}
                                onChange={handleGlassChange('blur')}
                                min={0}
                                max={50}
                                step={1}
                            />
                        </>
                    )}
                </div>
            </section>
        </div>
    );
};

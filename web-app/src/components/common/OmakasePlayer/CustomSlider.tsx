import React, { useCallback, useRef, useState, useEffect } from "react";
import "./CustomSlider.css";

interface CustomSliderProps {
    value: number;
    min: number;
    max: number;
    step?: number;
    onChange: (value: number) => void;
    onChangeCommitted?: (value: number) => void;
    disabled?: boolean;
    className?: string;
    style?: React.CSSProperties;
    ariaLabel?: string;
    showTooltip?: boolean;
    tooltipFormatter?: (value: number) => string;
    variant?: "timeline" | "volume";
    bufferedPercentage?: number; // For showing buffered content in timeline
}

export const CustomSlider: React.FC<CustomSliderProps> = ({
    value,
    min,
    max,
    step = 1,
    onChange,
    onChangeCommitted,
    disabled = false,
    className = "",
    style = {},
    ariaLabel,
    showTooltip = false,
    tooltipFormatter,
    variant = "timeline",
    bufferedPercentage = 0,
}) => {
    const sliderRef = useRef<HTMLDivElement>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [isHovered, setIsHovered] = useState(false);
    const [tooltipVisible, setTooltipVisible] = useState(false);

    const percentage = ((value - min) / (max - min)) * 100;

    const getValueFromPosition = useCallback(
        (clientX: number) => {
            if (!sliderRef.current) return value;

            const rect = sliderRef.current.getBoundingClientRect();
            const percentage = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
            const newValue = min + percentage * (max - min);

            if (step) {
                return Math.round(newValue / step) * step;
            }
            return newValue;
        },
        [min, max, step, value],
    );

    const handleMouseDown = useCallback(
        (e: React.MouseEvent) => {
            if (disabled) return;

            e.preventDefault();
            setIsDragging(true);

            const newValue = getValueFromPosition(e.clientX);
            onChange(newValue);
        },
        [disabled, getValueFromPosition, onChange],
    );

    const handleMouseMove = useCallback(
        (e: MouseEvent) => {
            if (!isDragging || disabled) return;

            const newValue = getValueFromPosition(e.clientX);
            onChange(newValue);
        },
        [isDragging, disabled, getValueFromPosition, onChange],
    );

    const handleMouseUp = useCallback(() => {
        if (isDragging) {
            setIsDragging(false);
            onChangeCommitted?.(value);
        }
    }, [isDragging, onChangeCommitted, value]);

    useEffect(() => {
        if (isDragging) {
            document.addEventListener("mousemove", handleMouseMove);
            document.addEventListener("mouseup", handleMouseUp);

            return () => {
                document.removeEventListener("mousemove", handleMouseMove);
                document.removeEventListener("mouseup", handleMouseUp);
            };
        }
    }, [isDragging, handleMouseMove, handleMouseUp]);

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (disabled) return;

            let newValue = value;
            const stepSize = step || (max - min) / 100;

            switch (e.key) {
                case "ArrowLeft":
                case "ArrowDown":
                    newValue = Math.max(min, value - stepSize);
                    break;
                case "ArrowRight":
                case "ArrowUp":
                    newValue = Math.min(max, value + stepSize);
                    break;
                case "Home":
                    newValue = min;
                    break;
                case "End":
                    newValue = max;
                    break;
                default:
                    return;
            }

            e.preventDefault();
            onChange(newValue);
            onChangeCommitted?.(newValue);
        },
        [disabled, value, step, min, max, onChange, onChangeCommitted],
    );

    const sliderStyles: React.CSSProperties = {
        position: "relative",
        width: "100%",
        height: variant === "timeline" ? "6px" : "4px",
        background:
            variant === "timeline"
                ? "linear-gradient(90deg, rgba(255, 255, 255, 0.1), rgba(255, 255, 255, 0.2), rgba(255, 255, 255, 0.1))"
                : "rgba(255, 255, 255, 0.2)",
        borderRadius: "3px",
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
        // boxShadow: variant === 'timeline'
        //     ? 'inset 0 1px 3px rgba(0, 0, 0, 0.3)'
        //     : 'inset 0 1px 2px rgba(0, 0, 0, 0.2)',
        // transform: isHovered ? 'scaleY(1.2)' : 'scaleY(1)',
        ...style,
    };

    const trackStyles: React.CSSProperties = {
        position: "absolute",
        top: 0,
        left: 0,
        height: "100%",
        width: `${percentage}%`,
        background:
            variant === "timeline"
                ? "linear-gradient(90deg, #0073BB, #0084CC, #0073BB)"
                : "linear-gradient(90deg, #0073BB, #0084CC)",
        borderRadius: "3px",
        transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
        // boxShadow: (isDragging || isHovered)
        //     ? variant === 'timeline'
        //         ? '0 0 12px rgba(0, 115, 187, 0.6), 0 0 4px rgba(0, 115, 187, 0.8)'
        //         : '0 0 8px rgba(0, 115, 187, 0.5), 0 0 2px rgba(0, 115, 187, 0.7)'
        //     : variant === 'timeline'
        //         ? '0 0 8px rgba(0, 115, 187, 0.4)'
        //         : '0 0 4px rgba(0, 115, 187, 0.3)',
    };

    const thumbStyles: React.CSSProperties = {
        position: "absolute",
        top: "50%",
        left: `${percentage}%`,
        transform: "translate(-50%, -50%)",
        width: variant === "timeline" ? "14px" : "12px",
        height: variant === "timeline" ? "14px" : "12px",
        background: "#0073BB",
        border: "2px solid #fff",
        borderRadius: "50%",
        cursor: disabled ? "not-allowed" : "grab",
        transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
        boxShadow:
            isDragging || isHovered
                ? "0 4px 12px rgba(0, 115, 187, 0.4), 0 0 0 4px rgba(0, 115, 187, 0.1)"
                : "0 2px 6px rgba(0, 0, 0, 0.2)",
        opacity: disabled ? 0.5 : 1,
        scale: isDragging ? "1.2" : isHovered ? "1.1" : "1",
    };

    if (isDragging) {
        thumbStyles.cursor = "grabbing";
    }

    const tooltipText = tooltipFormatter ? tooltipFormatter(value) : value.toString();

    return (
        <div
            className={`custom-slider ${className}`}
            style={{ position: "relative", padding: "8px 0" }}
        >
            <div
                ref={sliderRef}
                style={sliderStyles}
                onMouseDown={handleMouseDown}
                onMouseEnter={() => {
                    setIsHovered(true);
                    if (showTooltip) setTooltipVisible(true);
                }}
                onMouseLeave={() => {
                    setIsHovered(false);
                    if (showTooltip && !isDragging) setTooltipVisible(false);
                }}
                role="slider"
                aria-valuemin={min}
                aria-valuemax={max}
                aria-valuenow={value}
                aria-label={ariaLabel}
                tabIndex={disabled ? -1 : 0}
                onKeyDown={handleKeyDown}
            >
                {/* Buffered track (for timeline only) */}
                {variant === "timeline" && bufferedPercentage > 0 && (
                    <div
                        style={{
                            position: "absolute",
                            top: 0,
                            left: 0,
                            height: "100%",
                            width: `${bufferedPercentage}%`,
                            background: "rgba(255, 255, 255, 0.3)",
                            borderRadius: "3px",
                            transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
                        }}
                    />
                )}

                <div style={trackStyles} />
                <div style={thumbStyles} />

                {/* Progress indicators for timeline */}
                {variant === "timeline" && (
                    <>
                        <div
                            style={{
                                position: "absolute",
                                top: "50%",
                                left: 0,
                                right: 0,
                                height: "1px",
                                background:
                                    "linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.1), transparent)",
                                transform: "translateY(-50%)",
                                pointerEvents: "none",
                                opacity: isHovered ? 1 : 0.5,
                                transition: "opacity 0.2s ease",
                            }}
                        />

                        {/* Tick marks for major time intervals */}
                        {Array.from({ length: 5 }, (_, i) => (
                            <div
                                key={i}
                                style={{
                                    position: "absolute",
                                    top: "50%",
                                    left: `${(i + 1) * 20}%`,
                                    width: "1px",
                                    height: "8px",
                                    background: "rgba(255, 255, 255, 0.2)",
                                    transform: "translateY(-50%)",
                                    pointerEvents: "none",
                                    opacity: isHovered ? 0.6 : 0.3,
                                    transition: "opacity 0.2s ease",
                                }}
                            />
                        ))}
                    </>
                )}
            </div>

            {/* Tooltip */}
            {showTooltip && (tooltipVisible || isDragging) && (
                <div
                    style={{
                        position: "absolute",
                        top: variant === "timeline" ? "-45px" : "-40px",
                        left: `${Math.min(Math.max(percentage, 5), 95)}%`,
                        transform: "translateX(-50%)",
                        background: "linear-gradient(135deg, #0073BB, #0084CC)",
                        color: "white",
                        padding: "6px 12px",
                        borderRadius: "8px",
                        fontSize: "12px",
                        fontWeight: "600",
                        whiteSpace: "nowrap",
                        boxShadow: "0 4px 12px rgba(0, 115, 187, 0.4)",
                        border: "1px solid rgba(255, 255, 255, 0.2)",
                        backdropFilter: "blur(10px)",
                        zIndex: 1000,
                        animation: "fadeIn 0.2s ease-out",
                    }}
                >
                    {tooltipText}
                    <div
                        style={{
                            position: "absolute",
                            bottom: "-4px",
                            left: "50%",
                            transform: "translateX(-50%)",
                            width: 0,
                            height: 0,
                            borderLeft: "4px solid transparent",
                            borderRight: "4px solid transparent",
                            borderTop: "4px solid #0073BB",
                        }}
                    />
                </div>
            )}
        </div>
    );
};

export default CustomSlider;

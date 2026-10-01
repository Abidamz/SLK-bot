import os
from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable
from reportlab.pdfgen import canvas

class NumberedCanvas(canvas.Canvas):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._saved_page_states = []

    def showPage(self):
        self._saved_page_states.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        num_pages = len(self._saved_page_states)
        for state in self._saved_page_states:
            self.__dict__.update(state)
            self.draw_page_number(num_pages)
            canvas.Canvas.showPage(self)
        canvas.Canvas.save(self)

    def draw_page_number(self, page_count):
        self.saveState()
        self.setFont("Helvetica", 9)
        self.setFillColor(colors.HexColor("#718096"))
        page_text = f"Page {self._pageNumber} of {page_count}"
        self.drawRightString(612 - 54, 36, page_text)
        self.drawString(54, 36, "SLK Radar · Subscriber Terms of Service & Risk Disclaimer")
        self.setStrokeColor(colors.HexColor("#E2E8F0"))
        self.setLineWidth(0.5)
        self.line(54, 48, 612 - 54, 48)
        self.restoreState()

def generate_pdf(filename):
    doc = SimpleDocTemplate(
        filename,
        pagesize=letter,
        leftMargin=54,
        rightMargin=54,
        topMargin=54,
        bottomMargin=54
    )

    styles = getSampleStyleSheet()
    
    # Custom Palette
    c_primary = colors.HexColor("#0F172A") # Deep Navy
    c_accent = colors.HexColor("#0D9488")  # Teal Accent
    c_warning = colors.HexColor("#92400E") # Amber / Dark Warning
    c_warning_bg = colors.HexColor("#FEF3C7")
    c_text = colors.HexColor("#1E293B")
    c_muted = colors.HexColor("#64748B")

    title_style = ParagraphStyle(
        'DocTitle',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=20,
        leading=24,
        textColor=c_primary,
        spaceAfter=4
    )
    
    subtitle_style = ParagraphStyle(
        'DocSubtitle',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=10,
        leading=14,
        textColor=c_muted,
        spaceAfter=14
    )

    h1_style = ParagraphStyle(
        'Heading1',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=12,
        leading=16,
        textColor=c_primary,
        spaceBefore=14,
        spaceAfter=6,
        keepWithNext=True
    )

    body_style = ParagraphStyle(
        'Body',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=9.5,
        leading=13.5,
        textColor=c_text,
        spaceAfter=6
    )

    bullet_style = ParagraphStyle(
        'Bullet',
        parent=body_style,
        leftIndent=15,
        firstLineIndent=-10,
        spaceAfter=4
    )

    warning_text_style = ParagraphStyle(
        'WarningText',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=8.5,
        leading=12,
        textColor=c_warning
    )

    warning_title_style = ParagraphStyle(
        'WarningTitle',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=9.5,
        leading=13,
        textColor=c_warning,
        spaceAfter=4
    )

    story = []

    # Header section
    story.append(Paragraph("SLK RADAR · TERMS OF SERVICE & RISK DISCLAIMER", title_style))
    story.append(Paragraph("Official Subscriber Legal Agreement · Last Updated: September 18, 2026", subtitle_style))
    story.append(HRFlowable(width="100%", thickness=1.5, color=c_accent, spaceBefore=0, spaceAfter=12))

    # Warning Box
    warning_content = [
        [Paragraph("⚠️ HIGH-RISK INVESTMENT WARNING & REGULATORY DISCLAIMER", warning_title_style)],
        [Paragraph(
            "Trading foreign exchange (Forex), commodities, precious metals, Contracts for Difference (CFDs), and indices on margin carries a high level of risk and may not be suitable for all investors. The high degree of leverage available in these markets can work against you as well as for you. Before deciding to trade, you should carefully consider your investment objectives, level of financial experience, and risk appetite.<br/><br/>"
            "You could sustain a loss of some or all of your deposited capital. Never trade with funds you cannot afford to lose. All content, signals, directional bias analyses, and journal metrics provided by SLK Radar are intended strictly for educational and informational purposes, not financial or investment advice.",
            warning_text_style
        )]
    ]
    t = Table(warning_content, colWidths=[504])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), c_warning_bg),
        ('BOX', (0,0), (-1,-1), 1, colors.HexColor("#D97706")),
        ('TOPPADDING', (0,0), (-1,-1), 8),
        ('BOTTOMPADDING', (0,0), (-1,-1), 8),
        ('LEFTPADDING', (0,0), (-1,-1), 12),
        ('RIGHTPADDING', (0,0), (-1,-1), 12),
    ]))
    story.append(t)
    story.append(Spacer(1, 10))

    # Section 1
    story.append(Paragraph("1. Nature of the Service & No Financial Advice", h1_style))
    story.append(Paragraph(
        "SLK Radar operates as an algorithmic quantitative research model monitoring institutional market structure, liquidity sweeps, fair value gaps, and key-level confirmation entries.",
        body_style
    ))
    story.append(Paragraph("• <b>Educational & Research Tool:</b> All alerts, directional bias cards, watch notifications, technical levels, and track record entries are distributed purely as algorithmic market analysis and research.", bullet_style))
    story.append(Paragraph("• <b>Not a Financial Advisor:</b> SLK Radar, its creators, operators, and affiliates are not registered investment advisors (RIA), commodity trading advisors (CTA), or broker-dealers.", bullet_style))
    story.append(Paragraph("• <b>No Solicitations:</b> No publication or transmission by SLK Radar shall be construed as a solicitation, endorsement, or recommendation to buy or sell any security or financial derivative.", bullet_style))

    # Section 2
    story.append(Paragraph("2. Subscriber Responsibility & Execution Discretion", h1_style))
    story.append(Paragraph(
        "All trading activities and decisions are executed entirely at your own independent risk and discretion.",
        body_style
    ))
    story.append(Paragraph("• <b>Self-Directed Trading:</b> SLK Radar does not execute orders on your behalf, does not take custody of funds, and has no direct connectivity to your brokerage accounts.", bullet_style))
    story.append(Paragraph("• <b>Live Execution Variables:</b> Real market execution is subject to broker spreads, slippage, financing charges, swap fees, and execution latency that may cause actual live trading results to diverge from research models.", bullet_style))
    story.append(Paragraph("• <b>Risk Management:</b> You are solely responsible for determining position sizing, stop-loss management, and leverage. Conservative risk parameters are strongly recommended at all times.", bullet_style))

    # Section 3
    story.append(Paragraph("3. Hypothetical & Historical Performance Disclaimer", h1_style))
    story.append(Paragraph("• <b>Past Performance Is Not Indicative of Future Results:</b> Historical win rates, profit factors, R-multiples, and paper trading journal entries reflect automated rule-based cloud simulations. No representation is being made that any subscriber will or is likely to achieve profits or losses similar to those shown.", bullet_style))
    story.append(Paragraph("• <b>Inherent Limitations:</b> Simulated or paper trading does not involve actual financial risk and cannot completely account for the real-world impact of market liquidity deficits, news slippage, or broker rejection rates.", bullet_style))

    # Section 4
    story.append(Paragraph("4. Subscription Billing, Auto-Renewal & Cancellation", h1_style))
    story.append(Paragraph("• <b>Recurring Billing:</b> VIP Subscriptions are billed on a recurring monthly or periodic basis through Whop.", bullet_style))
    story.append(Paragraph("• <b>Auto-Renewal:</b> Subscriptions renew automatically unless canceled prior to the renewal date.", bullet_style))
    story.append(Paragraph("• <b>Self-Service Cancellation:</b> You may cancel your subscription at any time directly in your Whop Customer Portal. Upon cancellation, you will retain VIP channel access until the end of your current prepaid billing period, after which access terminates automatically.", bullet_style))

    # Section 5
    story.append(Paragraph("5. Strict No-Refund Policy", h1_style))
    story.append(Paragraph(
        "Due to the immediate delivery of proprietary intellectual property, algorithmic trade setups, and live broadcast alerts upon checkout, all subscription payments and renewals are <b>strictly non-refundable</b> once processed. No partial refunds or credits will be granted for unused periods.",
        body_style
    ))

    # Section 6
    story.append(Paragraph("6. Intellectual Property & Anti-Piracy Policy", h1_style))
    story.append(Paragraph("• <b>Single-User License:</b> Subscriptions grant a personal, non-transferable, revocable license for individual use only.", bullet_style))
    story.append(Paragraph("• <b>Strict Anti-Forwarding:</b> You may NOT copy, forward, rebroadcast, screenshot, resell, or distribute alerts, bias cards, or proprietary educational materials to any third party, group, chat, or public platform.", bullet_style))
    story.append(Paragraph("• <b>Enforcement:</b> Any subscriber caught redistributing signals or intellectual property will face immediate, permanent termination without refund, alongside potential legal action for intellectual property infringement.", bullet_style))

    # Section 7
    story.append(Paragraph("7. Limitation of Liability", h1_style))
    story.append(Paragraph(
        "To the fullest extent permitted by applicable law, in no event shall SLK Radar, its creators, developers, or affiliates be liable for any direct, indirect, incidental, punitive, or consequential damages, including but not limited to loss of capital, trading losses, loss of profits, or data loss arising out of or in connection with the use of this service.",
        body_style
    ))

    doc.build(story, canvasmaker=NumberedCanvas)
    print(f"Successfully generated {filename}")

if __name__ == "__main__":
    generate_pdf("dashboard/SLK_Radar_Terms_of_Service.pdf")

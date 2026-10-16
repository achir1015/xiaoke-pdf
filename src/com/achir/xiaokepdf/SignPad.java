package com.achir.xiaokepdf;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.view.MotionEvent;
import android.view.View;

/** 手寫簽名板。 */
public class SignPad extends View {
    private final Path path = new Path();
    private final Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
    private boolean empty = true;
    public int color = 0xFF10204A;

    public SignPad(Context c) {
        super(c);
        p.setStyle(Paint.Style.STROKE);
        p.setStrokeCap(Paint.Cap.ROUND);
        p.setStrokeJoin(Paint.Join.ROUND);
        p.setStrokeWidth(U.dp(3));
        setBackgroundColor(Color.WHITE);
    }

    @Override
    protected void onDraw(Canvas c) {
        Paint g = new Paint();
        g.setColor(0xFFCCCCCC);
        g.setStrokeWidth(U.dp(1));
        float y = getHeight() * 0.75f;
        c.drawLine(U.dp(16), y, getWidth() - U.dp(16), y, g);
        p.setColor(color);
        c.drawPath(path, p);
    }

    @Override
    public boolean onTouchEvent(MotionEvent e) {
        float x = e.getX(), y = e.getY();
        switch (e.getActionMasked()) {
            case MotionEvent.ACTION_DOWN: path.moveTo(x, y); path.lineTo(x + 0.1f, y); empty = false; break;
            case MotionEvent.ACTION_MOVE:
                for (int h = 0; h < e.getHistorySize(); h++) path.lineTo(e.getHistoricalX(h), e.getHistoricalY(h));
                path.lineTo(x, y);
                break;
        }
        getParent().requestDisallowInterceptTouchEvent(true);
        invalidate();
        return true;
    }

    public void clear() { path.reset(); empty = true; invalidate(); }
    public boolean isEmpty() { return empty; }

    /** 透明背景的簽名圖（裁掉空白）。 */
    public Bitmap bitmap() {
        Bitmap b = Bitmap.createBitmap(getWidth(), getHeight(), Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(b);
        p.setColor(color);
        c.drawPath(path, p);
        return Draw.trim(b);
    }
}

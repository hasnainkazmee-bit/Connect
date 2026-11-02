import { test, expect } from '@playwright/test';

test.describe('verified onboarding', () => {
  test.skip(process.env.CONNECT_ACCOUNT_E2E !== 'true', 'Runs against local SMTP in the services suite.');
  for (const mobile of [false, true]) test(`account creation, company setup and recovery on ${mobile ? 'phone' : 'desktop'}`, async ({ page, request }) => {
    await page.setViewportSize(mobile ? {width:390,height:844} : {width:1440,height:1000});
    const email = `browser-account-${Date.now()}-${mobile}@ui.test`;
    const password = 'ConnectBrowser123!';
    const errors: string[]=[]; page.on('pageerror', e=>errors.push(e.message));
    async function mailCode(subject: string) {
      let code='';
      await expect.poll(async()=>{
        const inbox=await(await request.get('http://127.0.0.1:8026/api/v1/messages')).json();
        const message=inbox.messages.find((m:any)=>m.Subject===subject && m.To.some((v:any)=>v.Address===email));
        if(message){const mail=await(await request.get('http://127.0.0.1:8026/api/v1/message/'+message.ID)).json();code=mail.Text.match(/\b\d{6}\b/)[0];}
        return code;
      }).toMatch(/^\d{6}$/);
      return code;
    }
    await page.goto('/'); await page.getByRole('button',{name:'Sign in',exact:true}).click();
    await page.getByRole('button',{name:'Create an account',exact:true}).click();
    await page.getByLabel('Your name').fill('Connect Test Owner');
    await page.getByLabel('Work email').fill(email); await page.getByLabel('Password',{exact:true}).fill(password);
    await page.screenshot({path:`test-results/connect-signup-${mobile?'mobile':'desktop'}.png`,fullPage:true});
    await page.getByRole('button',{name:'Create account',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Check your inbox.'})).toBeVisible();
    await page.getByLabel('Verification code').fill(await mailCode('Verify your Connect email'));
    await page.getByRole('button',{name:'Verify email',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Introduce your company.'})).toBeVisible();
    await page.getByLabel('Company name').fill('Connect UI Solar '+Date.now()+' '+mobile);
    await page.getByRole('button',{name:'EPC',exact:true}).click();
    await page.getByLabel('Based in').fill('Austin, TX');
    await page.getByRole('button',{name:'Installation',exact:true}).click();
    await page.screenshot({path:`test-results/connect-onboarding-${mobile?'mobile':'desktop'}.png`,fullPage:true});
    await page.getByRole('button',{name:'Continue',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Find your people.'})).toBeVisible();
    await page.getByRole('button',{name:'I’ll explore first',exact:true}).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const session=await(await page.request.get('/api/session')).json();
    expect(session.user.email_verified_at).toBeTruthy();expect(session.user.onboarding_completed_at).toBeTruthy();expect(session.companies[0].type).toBe('EPC');
    await page.goto('/account');await expect(page.getByText('Email verified',{exact:true})).toBeVisible();
    await page.request.post('/api/auth/logout');await page.goto('/');
    await page.getByRole('button',{name:'Sign in',exact:true}).click();
    await page.getByRole('button',{name:'Forgot password?',exact:true}).click();await page.getByLabel('Work email').fill(email);
    await page.getByRole('button',{name:'Send reset code'}).click();
    await page.getByLabel('Email code').fill(await mailCode('Reset your Connect password'));
    await page.getByLabel('New password',{exact:true}).fill('ConnectRecovered456!');await page.getByRole('button',{name:'Reset password',exact:true}).click();
    await expect(page.getByRole('status')).toContainText('Password updated');
    await page.getByLabel('Password',{exact:true}).fill('ConnectRecovered456!');
    await page.getByRole('dialog').getByRole('button',{name:'Sign in',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});

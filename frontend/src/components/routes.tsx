import { memo, ReactElement } from "react";

import { Menu, Icon, Divider } from "antd";
import { Link, Switch } from "react-router-dom";
import React from "react";
import { Section } from "./common";
import { Route, RouteProps, Redirect } from "react-router";
import { queryToObj } from "../utils/queryHelper";
import { PageComponentType, PageProps } from "./pages/Page";
import { UrlTestPage } from "./pages/UrlTestPage";
import { uiState as ui, uiSettings, uiState } from "../state/ui";
import { appGlobal } from "..";
import TopicList from "./pages/TopicList";
import TopicDetails from "./pages/TopicDetail";
import { observer } from "mobx-react";
import IndexPage from "./pages/IndexPage";
import GroupList from "./pages/GroupList";
import GroupDetails from "./pages/GroupDetails";
import BrokerList from "./pages/BrokerList";
import { AnimatePresence, Transition, motion } from "framer-motion";
import { DebugTimerStore } from "../utils/utils";

//
//	Route Types
//
export type IRouteEntry = PageDefinition<any> | PageGroup | SeparatorEntry;

export interface PageGroup {
    title: string
    children: IRouteEntry[]
}

export interface PageDefinition<TRouteParams = {}> {
    title: string
    path: string
    pageType: PageComponentType<TRouteParams>
    routeJsx: JSX.Element
    icon?: string
    menuItemKey?: string, // set by 'CreateRouteMenuItems'
}
export interface SeparatorEntry { isSeparator: boolean; }
const separator: SeparatorEntry = { isSeparator: true };

export function isPageDefinition(x: IRouteEntry): x is PageDefinition<any> { return (x as PageDefinition<any>).path !== undefined; }
export function isSeparator(x: IRouteEntry): x is SeparatorEntry { return (x as SeparatorEntry).isSeparator !== undefined; }
const routeStr = (r: PageDefinition<any> | null) => r ? r.path + ' - ' + r.title : 'null';

const MenuGroupTitle = observer((p: { title: string }) =>
    <div className={uiSettings.sideBarOpen ? '' : 'menu-divider-group-title'}>{p.title}</div>
);

// Generate content for <Menu> from all routes
export function CreateRouteMenuItems(entries: IRouteEntry[]): React.ReactNodeArray {
    return entries.map((entry, index) => {

        if (isPageDefinition(entry)) {
            // Menu entry for Page
            if (entry.path.includes(':'))
                return null; // only root-routes (no param) can be in menu

            return (
                <Menu.Item key={entry.path}>
                    <Link to={entry.path}>
                        <Icon type={entry.icon} />
                        <span>{entry.title}</span>
                    </Link>
                </Menu.Item>
            );
        }
        else if (isSeparator(entry)) {
            return <div key={index} className='menu-divider' />
        }
        else {
            // Group
            return (
                <Menu.ItemGroup key={entry.title} title={<MenuGroupTitle title={entry.title} />}>
                    {CreateRouteMenuItems(entry.children)}
                </Menu.ItemGroup>
            );
        }
    }).filter(x => x != null && x != undefined);
}

// Convert routes to <Route/> JSX declarations
function EmitRouteViews(entries: IRouteEntry[]): JSX.Element[] {

    const elements: JSX.Element[] = [];

    for (let entry of entries) {
        if (isPageDefinition(entry)) {
            elements.push(entry.routeJsx);
        } else if (isSeparator(entry)) {
            // seperators are not routes
        } else {
            let childJsxElements = EmitRouteViews(entry.children);
            elements.push(...childJsxElements);
        }
    }
    return elements;
}



// const Route = (p: {} & RouteProps) => <ReactRouterRoute {...p} {...props}/>
let routeCounter = 0;
export function routeCount(): number { return routeCounter++; }

export const RouteView = (() =>
    <AnimatePresence exitBeforeEnter>
        <Switch>
            {/* Index */}
            {/* <Route exact path='/' component={IndexPage} /> */}
            <Route exact path='/' render={() => <Redirect to='/topics' />} />

            {/* Emit all <Route/> elements */}
            {EmitRouteViews(APP_ROUTES)}

            <Route render={rp => {
                ui.pageTitle = '404';
                return (
                    <Section title='404'>
                        <div><h4>Path:</h4> <span>{rp.location.pathname}</span></div>
                        <div><h4>Query:</h4> <pre>{JSON.stringify(rp.location.search, null, 4)}</pre></div>
                    </Section>
                )
            }} />

        </Switch>
    </AnimatePresence>
)

function MakeRoute<TRouteParams>(path: string, page: PageComponentType<TRouteParams>, title: string, icon?: string, exact: boolean = true): PageDefinition<TRouteParams> {

    icon = icon || ' ';

    const route: PageDefinition<TRouteParams> = {
        title,
        path,
        pageType: page,
        routeJsx: (null as unknown as JSX.Element), // will be set below
        icon,
    }

    // todo: verify that path and route params match
    route.routeJsx = <Route path={route.path} key={route.title} exact={exact ? true : undefined} render={rp => {
        const matchedPath = rp.match.url;
        const query = queryToObj(rp.location.search);
        const { ...params } = rp.match.params;

        // Reset some things on page change
        if (ui.currentRoute && ui.currentRoute.path != route.path) {
            //console.log('switching route: ' + routeStr(ui.currentRoute) + " -> " + routeStr(route));
            uiState.pageHeaderExtra = () => null;
        }

        let pageProps: PageProps<TRouteParams> = {
            matchedPath,
            query,
            ...params,
        };

        ui.currentRoute = route;
        return <route.pageType {...pageProps} />
    }} />;

    return route;
}

//
// Route Definitions
// If a route has one or more parameters it will not be shown in the main menu (obviously, since the parameter would have to be known!)
//
export const APP_ROUTES: IRouteEntry[] = [

    MakeRoute<{}>('/brokers', BrokerList, 'Brokers', 'hdd'),

    MakeRoute<{}>('/topics', TopicList, 'Topics', 'profile'),
    MakeRoute<{ topicName: string }>('/topics/:topicName', TopicDetails, 'Topics', 'profile'),

    MakeRoute<{}>('/groups', GroupList, 'Consumer Groups', 'funnel-plot'),
    MakeRoute<{ groupId: string }>('/groups/:groupId/', GroupDetails, 'Consumer Groups', 'funnel-plot'),

    //separator,

    //MakeRoute<{}>('/users', UrlTestPage, 'Users', 'user'),
    //MakeRoute<{}>('/settings', UrlTestPage, 'Settings', 'tool'), // Tool Settings, UserSettings, Access, ...
    //MakeRoute<{}>('/license', UrlTestPage, 'License', 'copyright'),
];

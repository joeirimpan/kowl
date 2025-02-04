import React, { Component } from "react";
import { Table, Row, Statistic, Skeleton, Tag, Badge, Typography, Tree, Button, List, Collapse, Col, Checkbox, Card as AntCard, Input, Space, Tooltip, Popover, Empty } from "antd";
import { observer } from "mobx-react";

import { api } from "../../../state/backendApi";
import { PageComponent, PageInitHelper } from "../Page";
import { makePaginationConfig, sortField } from "../../misc/common";
import { MotionDiv } from "../../../utils/animationProps";
import { GroupDescription, GroupMemberDescription, GroupMemberAssignment, TopicLag } from "../../../state/restInterfaces";
import { groupConsecutive } from "../../../utils/utils";
import { observable, autorun } from "mobx";
import { appGlobal } from "../../../state/appGlobal";
import Card from "../../misc/Card";
import Icon, { FireOutlined, WarningTwoTone, HourglassTwoTone, FireTwoTone, CheckCircleTwoTone, QuestionCircleOutlined } from '@ant-design/icons';
import { Radio } from 'antd';
import { TablePaginationConfig } from "antd/lib/table";
import { OptionGroup, QuickTable, DefaultSkeleton, findPopupContainer } from "../../../utils/tsxUtils";
import { uiSettings } from "../../../state/ui";
import { SkipIcon } from "@primer/octicons-v2-react";
import { uiState } from "../../../state/uiState";
import { HideStatisticsBarButton } from "../../misc/HideStatisticsBarButton";


@observer
class GroupDetails extends PageComponent<{ groupId: string }> {
    @observable viewMode: 'topic' | 'member' = 'topic';
    @observable onlyShowPartitionsWithLag: boolean = false;
    pageRef = React.createRef();

    initPage(p: PageInitHelper): void {
        const group = this.props.groupId;

        p.title = this.props.groupId;
        p.addBreadcrumb('Consumer Groups', '/groups');
        if (group) p.addBreadcrumb(group, '/' + group);

        this.refreshData(false);
        appGlobal.onRefresh = () => this.refreshData(true);
    }

    refreshData(force: boolean) {
        api.refreshConsumerGroups(force);
    };

    render() {
        // Get info about the group
        const groupName = this.props.groupId;
        if (!api.consumerGroups) return DefaultSkeleton;
        const group = api.consumerGroups.find(e => e.groupId == groupName);
        if (!group) return DefaultSkeleton;

        // Get info about each topic
        const requiredTopics = group.members.flatMap(m => m.assignments.map(a => a.topicName)).distinct();

        const totalPartitions = group.members.flatMap(m => m.assignments).sum(a => a.partitionIds.length);
        const partitionsWithOffset = group.lag.topicLags.sum(tl => tl.partitionsWithOffset);
        const topicsWithOffset = group.lag.topicLags.length;

        return (
            <MotionDiv style={{ margin: '0 1rem' }}>
                {/* States can be: Dead, Initializing, Rebalancing, Stable */}
                {uiSettings.consumerGroupDetails.showStatisticsBar &&
                    <Card className='statisticsBar'>
                        <Row >
                            <HideStatisticsBarButton onClick={() => uiSettings.consumerGroupDetails.showStatisticsBar = false} />
                            <Statistic title='State' valueRender={() => <GroupState group={group} />} />
                            <ProtocolType group={group} />
                            <Statistic title='Members' value={group.members.length} />
                            <Statistic title='Assigned Topics' value={requiredTopics.length} />
                            <Statistic title='Topics with offset' value={topicsWithOffset} />
                            <Statistic title='Assigned Partitions' value={totalPartitions} />
                            <Statistic title='Partitions with offset' value={partitionsWithOffset} />
                            <Statistic title='Total Lag' value={group.lagSum} />
                        </Row>
                    </Card>
                }

                <Card>
                    {/* Settings: GroupBy, Partitions */}
                    <Space size='large' style={{ marginLeft: '.5em', marginBottom: '2em' }}>

                        <OptionGroup label='View'
                            options={{
                                "Members": 'member',
                                "Topics": 'topic'
                            }}
                            value={this.viewMode}
                            onChange={s => this.viewMode = s}
                        />

                        <OptionGroup label='Filter'
                            options={{
                                "Show All": false,
                                "With Lag": true
                            }}
                            value={this.onlyShowPartitionsWithLag}
                            onChange={s => this.onlyShowPartitionsWithLag = s}
                        />
                    </Space>

                    {this.viewMode == 'member'
                        ? <GroupByMembers group={group} onlyShowPartitionsWithLag={this.onlyShowPartitionsWithLag} />
                        : <GroupByTopics group={group} onlyShowPartitionsWithLag={this.onlyShowPartitionsWithLag} />
                    }

                </Card>
            </MotionDiv>
        );
    }
}


@observer
class GroupByTopics extends Component<{ group: GroupDescription, onlyShowPartitionsWithLag: boolean }>{

    pageConfig: TablePaginationConfig;

    constructor(props: any) {
        super(props);
        this.pageConfig = makePaginationConfig(30);
        this.pageConfig.hideOnSinglePage = true;
        this.pageConfig.showSizeChanger = false;
    }

    render() {
        const topicLags = this.props.group.lag.topicLags;
        const p = this.props;
        const allAssignments = p.group.members
            .flatMap(m => m.assignments
                .map(as => ({ member: m, topicName: as.topicName, partitions: as.partitionIds })));

        const lagsFlat = topicLags.flatMap(topicLag =>
            topicLag.partitionLags.map(partLag => {

                const assignedMember = allAssignments.find(e =>
                    e.topicName == topicLag.topic
                    && e.partitions.includes(partLag.partitionId));

                return {
                    topicName: topicLag.topic,
                    partitionId: partLag.partitionId,
                    lag: partLag.lag,

                    assignedMember: assignedMember?.member,
                    id: assignedMember?.member.id,
                    clientId: assignedMember?.member.clientId,
                    host: assignedMember?.member.clientHost
                }
            })
        );

        const lagGroupsByTopic = lagsFlat.groupInto(e => e.topicName).sort((a, b) => a.key.localeCompare(b.key));

        const topicEntries = lagGroupsByTopic.map(g => {
            const totalLagAll = g.items.sum(c => c.lag ?? 0);
            const partitionsAssigned = g.items.filter(c => c.assignedMember).length;

            if (p.onlyShowPartitionsWithLag)
                g.items.removeAll(e => e.lag === 0);

            if (g.items.length == 0)
                return null;

            return <Collapse.Panel key={g.key}
                header={
                    <div>
                        <span style={{ fontWeight: 600, fontSize: '1.1em' }}>{g.key}</span>
                        <Tooltip placement='top' title='Summed lag of all partitions of the topic' mouseEnterDelay={0}
                            getPopupContainer={findPopupContainer} >
                            <Tag style={{ marginLeft: '1em' }} color='blue'>lag: {totalLagAll}</Tag>
                        </Tooltip>
                        {/* <Tooltip placement='top' title='Number of partitions assigned / Number of partitions in the topic' mouseEnterDelay={0}>
                                <Tag color='blue'>partitions: {partitionCount}/{topicPartitionInfo?.length}</Tag>
                            </Tooltip> */}
                        <Tooltip placement='top' title='Number of assigned partitions' mouseEnterDelay={0}
                            getPopupContainer={findPopupContainer}>
                            <Tag color='blue'>assigned partitions: {partitionsAssigned}</Tag>
                        </Tooltip>
                    </div>
                }>

                <Table
                    size='small' showSorterTooltip={false}
                    pagination={this.pageConfig}
                    onChange={(pagination) => {
                        if (pagination.pageSize) uiSettings.consumerGroupDetails.pageSize = pagination.pageSize;
                        this.pageConfig.current = pagination.current;
                        this.pageConfig.pageSize = pagination.pageSize;
                    }}
                    dataSource={g.items}
                    rowKey={r => r.partitionId}
                    rowClassName={(r) => (r.assignedMember) ? '' : 'consumerGroupNoMemberAssigned'}
                    columns={[
                        { width: 100, title: 'Partition', dataIndex: 'partitionId', sorter: sortField('partitionId'), defaultSortOrder: 'ascend' },
                        {
                            width: 'auto', title: 'Assigned Member', dataIndex: 'id', sorter: sortField('id'),
                            render: (t, r) => (renderMergedID(r.id, r.clientId)) ?? <span style={{ opacity: 0.66, margin: '0 3px' }}><SkipIcon /> no assigned member</span>
                        },
                        { width: 'auto', title: 'Host', dataIndex: 'host', sorter: sortField('host') },
                        { width: 80, title: 'Lag', dataIndex: 'lag', sorter: sortField('lag') },
                    ]}
                />
            </Collapse.Panel>
        });

        const defaultExpand = lagGroupsByTopic.length == 1
            ? lagGroupsByTopic[0].key // only one -> expand
            : undefined; // more than one -> collapse

        const nullEntries = topicEntries.filter(e => e == null).length;
        if (topicEntries.length == 0 || topicEntries.length == nullEntries)
            return <Empty style={{
                background: 'radial-gradient(hsl(0deg 0% 100%) 40%, hsl(0deg 0% 97%) 90%)',
                borderRadius: '5px',
                padding: '1.5em'
            }}>
                <span>All {topicEntries.length} topics have been filtered (no lag on any partition).</span>
            </Empty>

        return <Collapse bordered={false} defaultActiveKey={defaultExpand}>{topicEntries}</Collapse>;
    }
}

@observer
class GroupByMembers extends Component<{ group: GroupDescription, onlyShowPartitionsWithLag: boolean }>{

    pageConfig: TablePaginationConfig;

    constructor(props: any) {
        super(props);
        this.pageConfig = makePaginationConfig(30);
        this.pageConfig.hideOnSinglePage = true;
        this.pageConfig.showSizeChanger = false;
    }

    render() {
        const topicLags = this.props.group.lag.topicLags;
        const p = this.props;

        const memberEntries = p.group.members
            // sorting actually not necessary
            // .sort((a, b) => a.id.localeCompare(b.id))
            .map((m, i) => {
                const assignments = m.assignments;

                const assignmentsFlat = assignments
                    .map(a => a.partitionIds.map(id => {
                        const topicLag = topicLags.find(t => t.topic == a.topicName);
                        const partLag = topicLag?.partitionLags.find(p => p.partitionId == id)?.lag;
                        return {
                            topicName: a.topicName,
                            partitionId: id,
                            partitionLag: partLag ?? 0,
                        }
                    })).flat();

                const totalLag = assignmentsFlat.sum(t => t.partitionLag ?? 0);
                const totalPartitions = assignmentsFlat.length;

                if (p.onlyShowPartitionsWithLag)
                    assignmentsFlat.removeAll(e => e.partitionLag === 0);

                if (assignmentsFlat.length == 0)
                    return null;

                return <Collapse.Panel key={m.id} forceRender={false}
                    header={
                        <div>
                            <span style={{ fontWeight: 600, fontSize: '1.1em' }}>{renderMergedID(m.id, m.clientId)}</span>
                            <Tooltip placement='top' title='Host of the member' mouseEnterDelay={0} getPopupContainer={findPopupContainer}>
                                <Tag style={{ marginLeft: '1em' }} color='blue'>host: {m.clientHost}</Tag>
                            </Tooltip>
                            <Tooltip placement='top' title='Number of assigned partitions' mouseEnterDelay={0} getPopupContainer={findPopupContainer}>
                                <Tag color='blue'>partitions: {totalPartitions}</Tag>
                            </Tooltip>
                            <Tooltip placement='top' title='Summed lag over all assigned partitions of all topics' mouseEnterDelay={0} getPopupContainer={findPopupContainer}>
                                <Tag color='blue'>lag: {totalLag}</Tag>
                            </Tooltip>
                        </div>
                    }>

                    <Table
                        size='small'
                        pagination={this.pageConfig}
                        dataSource={assignmentsFlat}
                        rowKey={r => r.topicName + r.partitionId}
                        columns={[
                            { width: 'auto', title: 'Topic', dataIndex: 'topicName', sorter: sortField('topicName') },
                            { width: 150, title: 'Partition', dataIndex: 'partitionId', sorter: sortField('partitionId') },
                            { width: 150, title: 'Lag', dataIndex: 'partitionLag', sorter: sortField('partitionLag'), defaultSortOrder: 'descend' },
                        ]}
                    />
                </Collapse.Panel>
            });

        const defaultExpand = p.group.members.length == 1
            ? p.group.members[0].id // if only one entry, expand it
            : undefined; // more than one -> collapse

        const nullEntries = memberEntries.filter(e => e == null).length;
        if (memberEntries.length == 0 || memberEntries.length == nullEntries)
            return <Empty style={{
                background: 'radial-gradient(hsl(0deg 0% 100%) 40%, hsl(0deg 0% 97%) 90%)',
                borderRadius: '5px',
                padding: '1.5em'
            }}>
                <span>All {memberEntries.length} members have been filtered (no lag on any partition).</span>
            </Empty>

        return <Collapse bordered={false} defaultActiveKey={defaultExpand}>{memberEntries}</Collapse>;
    }
}



const renderMergedID = (id?: string, clientId?: string) => {

    if (id && clientId && id.startsWith(clientId)) { // should always be true...
        const suffix = id.substring(clientId.length);

        return <span className='consumerGroupCompleteID'>
            <span className='consumerGroupName'>{clientId}</span>
            <span className='consumerGroupSuffix'>{suffix}</span>
        </span>
    }

    return <span className='consumerGroupCompleteID'>{clientId ?? id ?? ''}</span>
};



const stateIcons = new Map<string, JSX.Element>([
    ['stable', <CheckCircleTwoTone twoToneColor='#52c41a' />],
    ['completingrebalance', <HourglassTwoTone twoToneColor='#52c41a' />],
    ['preparingrebalance', <HourglassTwoTone twoToneColor='orange' />],
    ['empty', <WarningTwoTone twoToneColor='orange' />],
    ['dead', <FireTwoTone twoToneColor='orangered' />],
    ['unknown', <QuestionCircleOutlined />],
]);
const makeStateEntry = (iconName: string, displayName: string, description: string): [any, any] => [
    <span>{stateIcons.get(iconName)} <span style={{ fontSize: '85%', fontWeight: 600 }}>{displayName}</span></span>,
    <div style={{ maxWidth: '350px' }}>{description}</div>
]

const consumerGroupStateTable = QuickTable([
    makeStateEntry('stable', "Stable", "Consumer group has members which have been assigned partitions"),
    makeStateEntry('completingrebalance', "Completing Rebalance", "Kafka is assigning partitions to group members"),
    makeStateEntry('preparingrebalance', "Preparing Rebalance", "A reassignment of partitions is required, members have been asked to stop consuming"),
    makeStateEntry('empty', "Empty", "Consumer group exists, but does not have any members"),
    makeStateEntry('dead', "Dead", "Consumer group does not have any members and it's metadata has been removed"),
    makeStateEntry('unknown', "Unknown", "Group state is not known"),
], {
    gapHeight: '.5em',
    gapWidth: '.5em',
    keyStyle: { verticalAlign: 'top' },
});

export const GroupState = (p: { group: GroupDescription }) => {
    const state = p.group.state.toLowerCase();
    const icon = stateIcons.get(state);

    return <Popover content={consumerGroupStateTable} placement='right'>
        <span>
            {icon}
            <span> {p.group.state}</span>
        </span>
    </Popover>
}
const ProtocolType = (p: { group: GroupDescription }) => {
    const protocol = p.group.protocolType;
    if (protocol == 'consumer') return null;

    return <Statistic title='Protocol' value={protocol} />
}

export default GroupDetails;
